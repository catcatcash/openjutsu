import { apiAccess, HttpError, IMAGE_SIGNATURE, readFormData, StoredFile, VIDEO_SIGNATURE } from "../../../lib/http.ts";
import { NextResponse } from "next/server";
import { providerConfigured, swap } from "../../../lib/provider.ts";

export const runtime = "nodejs";

const FILE_CHECKS = {
  video: { signature: VIDEO_SIGNATURE, error: "The source must be an MP4, MOV, MKV, WebM or AVI video." },
  picture: { signature: IMAGE_SIGNATURE, error: "Photos must be PNG, JPEG or WebP images." },
};

function invalid(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: error instanceof HttpError ? error.status : 400 });
}

// Hands the upload to SWAP_API_URL instead of ComfyUI, for backends that run the swap themselves.
export async function POST(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  if (!providerConfigured()) return NextResponse.json({ error: "Set SWAP_API_URL to the backend that should make the video." }, { status: 400 });

  let upload: Awaited<ReturnType<typeof readFormData>>;
  try {
    upload = await readFormData(request, FILE_CHECKS);
    const video = upload.form.get("video");
    const picture = upload.form.get("picture");
    if (!(video instanceof StoredFile) || video.size === 0) throw new HttpError(400, "Drop a source video.");
    if (!(picture instanceof StoredFile) || picture.size === 0) throw new HttpError(400, "Add a character photo.");
  } catch (error) {
    return invalid(error);
  }
  try {
    return NextResponse.json({ url: await swap(upload.form) });
  } catch (error) {
    return invalid(error);
  } finally {
    await upload.dispose();
  }
}
