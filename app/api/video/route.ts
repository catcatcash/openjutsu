import { apiAccess, HttpError, IMAGE_SIGNATURE, readFormData, StoredFile } from "../../../lib/http.ts";
import { NextResponse } from "next/server";
import { pollVideo, readTemplateJson, startVideo } from "../../../lib/video.ts";

export const runtime = "nodejs";
export const maxDuration = 300;

const FILE_CHECKS = {
  p1: { signature: IMAGE_SIGNATURE, error: "Person 1 must be a PNG, JPEG or WebP image." },
  p2: { signature: IMAGE_SIGNATURE, error: "Person 2 must be a PNG, JPEG or WebP image." },
};

function invalid(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: error instanceof HttpError ? error.status : 400 });
}

async function bytes(entry: FormDataEntryValue | null, missing: string) {
  if (!(entry instanceof StoredFile) || entry.size === 0) throw new HttpError(400, missing);
  return new Uint8Array(await entry.arrayBuffer());
}

// Starts a render: plates, uploads, submit. Returns the renderer's task id.
export async function POST(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;

  let upload: Awaited<ReturnType<typeof readFormData>> | undefined;
  let started: { task: string };
  try {
    const reading = await readFormData(request, FILE_CHECKS);
    upload = reading;
    started = await startVideo({
      template: await readTemplateJson(),
      p1: await bytes(reading.form.get("p1"), "Add the photo of person 1."),
      p2: await bytes(reading.form.get("p2"), "Add the photo of person 2."),
      wardrobe: { p1: String(reading.form.get("wardrobe_p1") ?? ""), p2: String(reading.form.get("wardrobe_p2") ?? "") },
    });
  } catch (error) {
    return invalid(error);
  } finally {
    await upload?.dispose();
  }
  return NextResponse.json(started);
}

// Polls one render.
export async function GET(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  const task = new URL(request.url).searchParams.get("task") ?? "";
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(task)) return NextResponse.json({ error: "Invalid render id." }, { status: 400 });
  try {
    return NextResponse.json(await pollVideo(task));
  } catch (error) {
    return invalid(error);
  }
}
