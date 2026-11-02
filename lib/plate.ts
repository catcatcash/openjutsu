// NOIZ templates start from a composed plate: the layout frame supplies pose and framing, the two character photos
// supply identity, and Gemini draws the finished frame the video renderer starts and ends on.
// Set MULTI_COMPOSITE_GEMINI_API_KEY (the variable NOIZ's own worker uses) and NOIZ_TEMPLATE to the template JSON.
import { readFile } from "node:fs/promises";
import { HttpError } from "./http.ts";

const MODEL = process.env.NOIZ_PLATE_MODEL?.trim() || "gemini-3-pro-image";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type Template = {
  action: {
    api_kind: string;
    api_params: Record<string, unknown> & {
      layout_frame: string;
      layout_frame_end: string;
      plate_compose_prompt_start: string;
      plate_compose_prompt_end: string;
    };
    input_slots: { key: string; guide_three_view_url?: string }[];
  };
};

export async function loadTemplate(): Promise<Template> {
  const path = process.env.NOIZ_TEMPLATE?.trim();
  if (!path) throw new HttpError(400, "Set NOIZ_TEMPLATE to the template JSON to compose from.");
  try {
    return JSON.parse(await readFile(path, "utf8")) as Template;
  } catch {
    throw new HttpError(400, "NOIZ_TEMPLATE does not point at a readable template JSON.");
  }
}

type Part = { inline_data: { mime_type: string; data: string } } | { text: string };

function part(bytes: Uint8Array, mime = "image/jpeg"): Part {
  return { inline_data: { mime_type: mime, data: Buffer.from(bytes).toString("base64") } };
}

async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new HttpError(502, `Could not read ${url} (HTTP ${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

// The template's own prompts name Image 1..3, so the order here is the contract: layout, p1, p2, then the scene.
export async function composePlate({ template, layout, p1, p2, scene }: {
  template: Template;
  layout: "start" | "end";
  p1: Uint8Array;
  p2: Uint8Array;
  scene?: Uint8Array;
}): Promise<{ bytes: Uint8Array; type: string }> {
  const key = process.env.MULTI_COMPOSITE_GEMINI_API_KEY?.trim();
  if (!key) throw new HttpError(400, "Set MULTI_COMPOSITE_GEMINI_API_KEY to compose plates.");

  const params = template.action.api_params;
  const frame = layout === "start" ? params.layout_frame : params.layout_frame_end;
  const prompt = (layout === "start" ? params.plate_compose_prompt_start : params.plate_compose_prompt_end)
    .replace("{{scene_binding}}", scene ? "Image 4 is the selected scene: it supplies the complete environment." : "Match the setting shown in Image 1.");

  const parts: Part[] = [part(await download(frame)), part(p1), part(p2)];
  if (scene) parts.push(part(scene));
  parts.push({ text: prompt });

  const response = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { response_modalities: ["IMAGE"], imageConfig: { aspectRatio: String(params.aspect_ratio ?? "16:9") } },
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  const reply = (await response.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType?: string } }[] } }[]; error?: { message?: string } };
  if (!response.ok) throw new HttpError(502, reply.error?.message ?? `The plate composer answered with HTTP ${response.status}.`);
  const image = reply.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!image?.data) throw new HttpError(502, "The plate composer returned no image.");
  return { bytes: new Uint8Array(Buffer.from(image.data, "base64")), type: image.mimeType ?? "image/png" };
}
