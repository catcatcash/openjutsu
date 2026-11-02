import { apiAccess, HttpError, IMAGE_SIGNATURE, readFormData, StoredFile } from "../../../lib/http.ts";
import { NextResponse } from "next/server";
import { composePlate, loadTemplate } from "../../../lib/plate.ts";

export const runtime = "nodejs";

const FILE_CHECKS = {
  p1: { signature: IMAGE_SIGNATURE, error: "Person 1 must be a PNG, JPEG or WebP image." },
  p2: { signature: IMAGE_SIGNATURE, error: "Person 2 must be a PNG, JPEG or WebP image." },
  scene: { signature: IMAGE_SIGNATURE, error: "The scene must be a PNG, JPEG or WebP image." },
};

function invalid(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: error instanceof HttpError ? error.status : 400 });
}

async function bytes(entry: FormDataEntryValue | null, missing: string) {
  if (!(entry instanceof StoredFile) || entry.size === 0) throw new HttpError(400, missing);
  return new Uint8Array(await entry.arrayBuffer());
}

// Draws the START or END plate a NOIZ template renders from: the layout frame plus the two character photos.
export async function POST(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;

  let upload: Awaited<ReturnType<typeof readFormData>> | undefined;
  let composed: { bytes: Uint8Array; type: string };
  try {
    const reading = await readFormData(request, FILE_CHECKS);
    upload = reading;
    const layout = String(reading.form.get("layout") ?? "start");
    if (layout !== "start" && layout !== "end") throw new HttpError(400, "Choose layout start or end.");
    const scene = reading.form.get("scene");
    composed = await composePlate({
      template: await loadTemplate(),
      layout,
      p1: await bytes(reading.form.get("p1"), "Add the photo of person 1."),
      p2: await bytes(reading.form.get("p2"), "Add the photo of person 2."),
      scene: scene instanceof StoredFile && scene.size > 0 ? await bytes(scene, "") : undefined,
    });
  } catch (error) {
    return invalid(error);
  } finally {
    await upload?.dispose();
  }
  return new Response(composed.bytes as BodyInit, { headers: { "Content-Type": composed.type, "Cache-Control": "no-store" } });
}
