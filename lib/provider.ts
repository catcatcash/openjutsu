// A generation backend reached over HTTP instead of a local ComfyUI graph: set SWAP_API_URL (and SWAP_API_KEY if the
// backend wants one) and the upload is forwarded as multipart, then polled until the backend names a result.
// Contract, kept to what a swap needs:
//   POST {SWAP_API_URL}      multipart(video, picture, prompt, resolution) -> {"url"} or {"id"} (job_id is read too)
//   GET  {SWAP_API_URL}/{id} -> {"status": "queued|running|succeeded|failed", "url", "error"}
// ponytail: one contract, two reply shapes. Add fields when a real backend needs them.
import { HttpError } from "./http.ts";

const DONE = new Set(["succeeded", "success", "done", "completed", "finished"]);
const FAILED = new Set(["failed", "error", "canceled", "cancelled", "expired"]);
const POLL_MS = 2000;
const GIVE_UP_MS = 60 * 60_000;

type Reply = { url?: string; id?: string; job_id?: string; status?: string; error?: string; message?: string };

export function providerConfigured() {
  return Boolean(process.env.SWAP_API_URL?.trim());
}

function base() {
  return process.env.SWAP_API_URL!.trim().replace(/\/+$/, "");
}

function headers(extra: Record<string, string> = {}) {
  const key = process.env.SWAP_API_KEY?.trim();
  return key ? { ...extra, Authorization: key } : extra;
}

async function read(response: Response): Promise<Reply> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Reply;
  } catch {
    throw new HttpError(502, `The generation backend answered with HTTP ${response.status} and no JSON.`);
  }
}

function failed(response: Response, reply: Reply) {
  const message = reply.error || reply.message;
  return new HttpError(response.status >= 500 ? 502 : 400, message ?? `The generation backend answered with HTTP ${response.status}.`);
}

export async function swap(form: FormData): Promise<string> {
  const sent = await fetch(base(), { method: "POST", headers: headers(), body: form, signal: AbortSignal.timeout(10 * 60_000) });
  const reply = await read(sent);
  if (!sent.ok) throw failed(sent, reply);
  if (reply.url) return reply.url;
  const id = reply.id ?? reply.job_id;
  if (!id) throw new HttpError(502, "The generation backend returned neither a video URL nor a job ID.");
  return wait(id);
}

async function wait(id: string): Promise<string> {
  const deadline = Date.now() + GIVE_UP_MS;
  for (;;) {
    const polled = await fetch(`${base()}/${encodeURIComponent(id)}`, { headers: headers(), signal: AbortSignal.timeout(60_000) });
    const reply = await read(polled);
    if (!polled.ok) throw failed(polled, reply);
    const status = (reply.status ?? "").toLowerCase();
    if (reply.url && (DONE.has(status) || !status)) return reply.url;
    if (FAILED.has(status)) throw new HttpError(502, "The generation backend could not make the video.");
    if (Date.now() > deadline) throw new HttpError(504, "The generation backend took longer than an hour.");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
