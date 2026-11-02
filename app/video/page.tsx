"use client";

import { useEffect, useState } from "react";

const PICKERS = [
  { key: "p1", label: "Person 1 (left)", wardrobe: "wardrobe_p1" },
  { key: "p2", label: "Person 2 (right)", wardrobe: "wardrobe_p2" },
] as const;

const DONE = new Set(["succeeded", "completed", "success"]);
const FAILED = new Set(["failed", "error", "canceled", "cancelled"]);

export default function VideoPage() {
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [wardrobe, setWardrobe] = useState<Record<string, string>>({});
  const [task, setTask] = useState("");
  const [status, setStatus] = useState("");
  const [video, setVideo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // ?task=<id> resumes a render after a reload instead of starting a new one (and paying for it again).
  useEffect(() => {
    const resumed = new URLSearchParams(window.location.search).get("task");
    if (resumed) {
      setTask(resumed);
      setStatus("resumed");
    }
  }, []);

  useEffect(() => {
    if (!task || DONE.has(status) || FAILED.has(status)) return;
    const tick = setInterval(() => setSeconds((value) => value + 1), 1000);
    const poll = setInterval(async () => {
      const response = await fetch(`/api/video?task=${encodeURIComponent(task)}`);
      const reply = await response.json();
      if (!response.ok) return setError(reply.error ?? "Could not read the render.");
      setStatus(reply.status ?? "");
      if (reply.error) setError(reply.error);
      if (reply.url) setVideo(reply.url);
    }, 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [task, status]);

  async function generate() {
    setBusy(true);
    setError("");
    setVideo("");
    setTask("");
    setStatus("composing plates");
    setSeconds(0);
    const form = new FormData();
    for (const { key, wardrobe: field } of PICKERS) {
      if (files[key]) form.set(key, files[key]!);
      if (wardrobe[field]) form.set(field, wardrobe[field]);
    }
    try {
      const response = await fetch("/api/video", { method: "POST", body: form });
      const reply = await response.json();
      if (!response.ok) {
        setError(reply.error ?? `The render failed to start (HTTP ${response.status}).`);
        setStatus("");
        return;
      }
      setTask(reply.task);
      setStatus("queued");
    } catch {
      setError("Could not reach the renderer.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(files.p1 && files.p2);

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <div className="mark">忍</div>
          <div>
            <h1>Swap two people</h1>
            <p>A NOIZ template, rendered by MiniMax H3.</p>
          </div>
        </div>
      </header>

      <section className="panel">
        <h2>
          <span>1</span> Photos
        </h2>
        <div className="characters">
          {PICKERS.map(({ key, label, wardrobe: field }) => (
            <div key={key} style={{ display: "grid", gap: 8 }}>
              <label className="drop">
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => setFiles((previous) => ({ ...previous, [key]: event.target.files?.[0] }))}
                />
                <strong>{files[key]?.name ?? label}</strong>
                <small>Drop or click to choose</small>
              </label>
              <input
                placeholder="Wardrobe, e.g. red hoodie and jeans (optional)"
                value={wardrobe[field] ?? ""}
                onChange={(event) => setWardrobe((previous) => ({ ...previous, [field]: event.target.value }))}
                style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="row">
          <p className="hint">Two faces in, one 15 s clip out. The template supplies the scene, camera and motion.</p>
          <button className="primary" disabled={!ready || busy || Boolean(task) && !error && !video} onClick={generate}>
            {busy ? "Starting…" : video ? "Render again" : "Generate video"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {task && (
          <p className="hint">
            {DONE.has(status) ? "Done." : FAILED.has(status) ? `Failed: ${status}` : `Rendering — ${status}, ${Math.floor(seconds / 60)}m ${seconds % 60}s`}
            <small> task {task}</small>
          </p>
        )}
        {video && <video src={video} controls loop playsInline style={{ width: "100%", borderRadius: 12 }} />}
      </section>
    </main>
  );
}
