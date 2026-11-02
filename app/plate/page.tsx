"use client";

import { useState } from "react";

type Layout = "start" | "end";

const PICKERS = [
  { key: "p1", label: "Person 1 (from left)", required: true },
  { key: "p2", label: "Person 2 (from left)", required: true },
  { key: "scene", label: "Scene (optional)", required: false },
] as const;

export default function PlatePage() {
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [layout, setLayout] = useState<Layout>("start");
  const [plate, setPlate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function compose() {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("layout", layout);
    for (const [key, file] of Object.entries(files)) if (file) form.set(key, file);
    try {
      const response = await fetch("/api/plate", { method: "POST", body: form });
      if (!response.ok) {
        setError((await response.json().catch(() => ({ error: `Composing failed (HTTP ${response.status}).` }))).error);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      setPlate((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
    } catch {
      setError("Could not reach the plate composer.");
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
            <h1>Compose a plate</h1>
            <p>The frame a NOIZ template starts and ends its video on.</p>
          </div>
        </div>
      </header>

      <section className="panel">
        <h2>
          <span>1</span> Photos
        </h2>
        <div className="characters">
          {PICKERS.map(({ key, label, required }) => (
            <label key={key} className="drop">
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => setFiles((previous) => ({ ...previous, [key]: event.target.files?.[0] }))}
              />
              <strong>{files[key]?.name ?? label}</strong>
              <small>{required ? "Required" : "Drop or click to choose"}</small>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>
          <span>2</span> Layout
        </h2>
        <div className="segmented">
          {(["start", "end"] as const).map((option) => (
            <button key={option} className={layout === option ? "on" : ""} onClick={() => setLayout(option)}>
              {option === "start" ? "START · medium pair" : "END · wide pair"}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="row">
          <p className="hint">Gemini draws the frame from the template's own layout and prompts.</p>
          <button className="primary" disabled={!ready || busy} onClick={compose}>
            {busy ? "Composing…" : "Compose plate"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {plate && <img src={plate} alt={`${layout} plate`} style={{ width: "100%", borderRadius: 12 }} />}
      </section>
    </main>
  );
}
