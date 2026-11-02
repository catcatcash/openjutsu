// A NOIZ template rendered as a video: the plates from lib/plate, the template's own depth clip as the motion
// reference, the source soundtrack, and its authored director prompt — submitted to Metaso's MiniMax-H3 API.
// Needs METASO_API_KEY and METASO_BASE_URL, the same variables NOIZ's worker reads.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { HttpError } from "./http.ts";
import { composePlate, type Template } from "./plate.ts";

const run = promisify(execFile);
const BUCKET = "noiz-grokbot-public";
const MODEL = "MiniMax-H3";
const RESOLUTION = "768P";
const MAX_SECONDS = 15;

function metaso() {
  const key = process.env.METASO_API_KEY?.trim();
  const base = process.env.METASO_BASE_URL?.trim().replace(/\/+$/, "");
  if (!key || !base) throw new HttpError(400, "Set METASO_API_KEY and METASO_BASE_URL to render.");
  return { key, base };
}

async function ffprobe(path: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  return Number(stdout.trim());
}

async function download(url: string, path: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new HttpError(502, `Could not read ${url} (HTTP ${response.status}).`);
  await writeFile(path, new Uint8Array(await response.arrayBuffer()));
}

// The bucket the whole-role-swap recipe uses: Metaso fetches these URLs itself, so they have to be public.
// ponytail: the ACL is best effort — buckets with uniform access already serve objects publicly and refuse per-object
// ACLs for accounts that are not OWNER, which is what this account is.
async function publish(dir: string, local: string, prefix: string, name: string) {
  const dest = `gs://${BUCKET}/${prefix}/${name}`;
  try {
    await run("gsutil", ["-h", "Cache-Control:public,max-age=3600", "cp", join(dir, local), dest], { maxBuffer: 1 << 24 });
  } catch (error) {
    throw new HttpError(502, `Could not upload ${name} to ${BUCKET}: ${(error as Error).message.slice(-200)}`);
  }
  await run("gsutil", ["acl", "ch", "-u", "AllUsers:R", dest], { maxBuffer: 1 << 24 }).catch(() => {});
  return `https://storage.googleapis.com/${BUCKET}/${prefix}/${name}`;
}

export async function startVideo({ template, p1, p2, wardrobe }: {
  template: Template;
  p1: Uint8Array;
  p2: Uint8Array;
  wardrobe?: { p1?: string; p2?: string };
}): Promise<{ task: string }> {
  const { key, base } = metaso();
  const params = template.action.api_params;
  const dir = await mkdtemp(join(tmpdir(), "openjutsu-video-"));
  try {
    // 1. Plates: the frames the render starts and ends on.
    const start = await composePlate({ template, layout: "start", p1, p2 });
    const end = await composePlate({ template, layout: "end", p1, p2 });
    await writeFile(join(dir, "plate_start.png"), Buffer.from(start.bytes));
    await writeFile(join(dir, "plate_end.png"), Buffer.from(end.bytes));
    await writeFile(join(dir, "p1.jpg"), Buffer.from(p1));
    await writeFile(join(dir, "p2.jpg"), Buffer.from(p2));

    // 2. Motion reference: the template's depth clip, tail frozen so a fast render does not fall back to the grey map.
    await download(params.source_video, join(dir, "source.mp4"));
    await download(params.depth_video_short, join(dir, "depth.mp4"));
    const depthSeconds = await ffprobe(join(dir, "depth.mp4"));
    const hold = Math.max(0, Math.min(0.45, 15.45 - depthSeconds));
    await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "depth.mp4"), "-vf", `tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}`,
      "-t", (depthSeconds + hold).toFixed(2), join(dir, "depth_ref.mp4")]);

    // 3. Soundtrack, cut to the length H3 takes.
    const seconds = Math.min(MAX_SECONDS, await ffprobe(join(dir, "source.mp4")));
    await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "source.mp4"), "-vn", "-af", `atrim=0:${seconds},asetpts=PTS-STARTPTS`,
      "-acodec", "libmp3lame", "-q:a", "2", join(dir, "orig.mp3")]);

    // 4. The template's own prompt, with the wardrobe read off each person's photo unless one was given.
    const prompt = params.director_prompt_short
      .replace("{{p1_outfit}}", wardrobe?.p1?.trim() || "the outfit worn in Image 2")
      .replace("{{p2_outfit}}", wardrobe?.p2?.trim() || "the outfit worn in Image 3")
      .replace("{{creative}}", "");

    // 5. Publish and submit.
    const prefix = `${template.action.api_kind}/ui_${Date.now()}`;
    const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
    for (const [name, type] of [["plate_start.png", "image_url"], ["p1.jpg", "image_url"], ["p2.jpg", "image_url"],
      ["plate_end.png", "image_url"], ["depth_ref.mp4", "video_url"], ["orig.mp3", "audio_url"]] as const) {
      const url = await publish(dir, name, prefix, name);
      content.push({ type, role: `reference_${type.split("_")[0]}`, [type]: { url } });
    }
    const body = { model: MODEL, resolution: RESOLUTION, duration: Math.round(seconds), ratio: String(params.aspect_ratio ?? "16:9"), content };
    const response = await fetch(`${base}/v2/video_generation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const reply = (await response.json().catch(() => ({}))) as { task_id?: string; error?: unknown };
    const task = reply.task_id;
    if (!response.ok || !task) throw new HttpError(502, `The renderer refused it (HTTP ${response.status}): ${JSON.stringify(reply.error ?? reply).slice(0, 300)}`);
    return { task };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type Render = { status: string; url?: string; error?: string };

export async function pollVideo(task: string): Promise<Render> {
  const { key, base } = metaso();
  const response = await fetch(`${base}/v2/query/video_generation/${encodeURIComponent(task)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60_000),
  });
  const reply = (await response.json().catch(() => ({}))) as {
    task?: { status?: string; content?: { url?: string }; fail_reasons?: string[]; message?: string };
    error?: unknown;
  };
  if (!response.ok) throw new HttpError(502, `The renderer answered with HTTP ${response.status}.`);
  const status = (reply.task?.status ?? "").toLowerCase();
  return {
    status: status || "unknown",
    url: reply.task?.content?.url,
    error: reply.task?.fail_reasons?.join("; ") || reply.task?.message,
  };
}

export async function readTemplateJson(): Promise<Template> {
  const path = process.env.NOIZ_TEMPLATE?.trim();
  if (!path) throw new HttpError(400, "Set NOIZ_TEMPLATE to the template JSON to render from.");
  return JSON.parse(await readFile(path, "utf8")) as Template;
}
