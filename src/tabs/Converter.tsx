import { useState, useEffect } from "react";
import type React from "react";
import { pickFolder, pickFiles, getScriptPath } from "../lib/dialog";
import { getSetting, setSetting } from "../lib/store";
import { useProcess } from "../lib/process";
import LogOutput from "../components/LogOutput";

const CODEC_MODES = [
  { id: "h264",    name: "Delivery", sub: "H.264",         desc: "Most compatible. Great for sharing, streaming, and general use." },
  { id: "h265",    name: "HEVC",     sub: "H.265",         desc: "Half the size of H.264 at the same quality. Best for storage and modern devices." },
  { id: "clip",    name: "Clip",     sub: "ProRes Proxy",  desc: "Small file size, fast exports. Good for rough cuts and proxy editing." },
  { id: "edit",    name: "Edit",     sub: "ProRes 422",    desc: "Balanced quality/size for everyday editing." },
  { id: "color",   name: "Color",    sub: "ProRes 422 HQ", desc: "Higher data rate for heavy color grading." },
  { id: "main",    name: "Main",     sub: "DNxHR HQ",      desc: "Avid-native codec. Bitrate auto-selected based on resolution and frame rate." },
  { id: "quality", name: "Quality",  sub: "ProRes 4444",   desc: "Archival quality with alpha channel support. Largest file size." },
] as const;

const VIDEO_FORMATS = [
  { id: "mp4", label: "MP4" }, { id: "mkv", label: "MKV" }, { id: "mov", label: "MOV" },
  { id: "webm", label: "WebM" }, { id: "avi", label: "AVI" },
] as const;

const AUDIO_FORMATS = [
  { id: "mp3", label: "MP3" }, { id: "aac", label: "AAC" }, { id: "wav", label: "WAV" },
  { id: "flac", label: "FLAC" }, { id: "opus", label: "Opus" },
] as const;

const QUALITY_PRESETS = [
  { id: "low", label: "Low", desc: "Smallest file" },
  { id: "medium", label: "Medium", desc: "Balanced" },
  { id: "high", label: "High", desc: "Best quality" },
  { id: "lossless", label: "Lossless", desc: "No quality loss (WAV/FLAC only for audio)" },
] as const;

type CodecModeId  = (typeof CODEC_MODES)[number]["id"];
type QualityId    = (typeof QUALITY_PRESETS)[number]["id"];
type SourceMode   = "single" | "multi" | "folder";
type ConverterTab = "format" | "codec";

const VIDEO_EXTS = ["mp4","mkv","mov","avi","webm","m4v","flv","ts","mts"];
const ALL_EXTS   = [...VIDEO_EXTS, "mp3","aac","wav","flac","opus","m4a"];

export default function Converter({ bodyRef }: { bodyRef: React.RefObject<HTMLDivElement | null> }) {
  const { state, isRunning, start, cancel, clearLines } = useProcess("converter");

  const [tab, setTab]               = useState<ConverterTab>("format");
  const [sourceMode, setSourceMode] = useState<SourceMode>("single");
  const [files, setFiles]           = useState<string[]>([]);
  const [folder, setFolder]         = useState("");
  const [outDir, setOutDir]         = useState("");
  const [targetFormat, setTargetFormat] = useState("mp4");
  const [quality, setQuality]       = useState<QualityId>("medium");
  const [codecMode, setCodecMode]   = useState<CodecModeId>("h264");
  const [crf, setCrf]               = useState(23);

  useEffect(() => {
    getSetting<string>("convOutDir", "").then(setOutDir);
  }, []);

  // Scroll to top when this tab becomes visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && bodyRef.current) {
          bodyRef.current.scrollTop = 0;
        }
      },
      { threshold: 0.1 }
    );
    if (bodyRef.current) observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, []);

  const handlePickSingle = async () => {
    const sel = await pickFiles(tab === "format" ? ALL_EXTS : VIDEO_EXTS);
    if (sel && sel.length > 0) setFiles([sel[0]]);
  };
  const handlePickMulti = async () => {
    const sel = await pickFiles(tab === "format" ? ALL_EXTS : VIDEO_EXTS);
    if (sel) setFiles((prev) => [...new Set([...prev, ...sel])]);
  };
  const handlePickFolder  = async () => { const s = await pickFolder(); if (s) setFolder(s); };
  const handlePickOutDir  = async () => {
    const s = await pickFolder();
    if (s) { setOutDir(s); setSetting("convOutDir", s); }
  };

  const removeFile = (path: string) => setFiles((prev) => prev.filter((f) => f !== path));
  const fileName   = (path: string) => path.split(/[\\/]/).pop() ?? path;

  const handleRun = async () => {
    const hasInput = sourceMode === "folder" ? !!folder : files.length > 0;
    if (!hasInput || isRunning) return;

    const scriptPath = await getScriptPath("scripts/convert.py");
    const pythonCmd  = (await getSetting<string>("pythonPath", "")) || "python3";

    const args: string[] = [scriptPath];
    if (tab === "format") {
      args.push("--format", targetFormat, "--quality", quality);
    } else {
      args.push("--mode", codecMode);
      if (codecMode === "h264" || codecMode === "h265") args.push("--crf", String(crf));
    }
    if (sourceMode === "folder") args.push("--folder", folder);
    else args.push("--files", ...files);
    if (outDir) args.push("--outdir", outDir);

    start(pythonCmd, args, false);
  };

  const hasInput = sourceMode === "folder" ? !!folder : files.length > 0;
  const statusLabel: Record<string, string> = { idle: "Ready", running: "Converting…", done: "Done", error: "Error" };

  return (
    <div className="tab">
      <div className="tab-header">
        <h1>Converter</h1>
        <p>Convert video files using ffmpeg</p>
      </div>
      <div className="tab-body" ref={bodyRef}>

        {/* Source */}
        <div className="field-group">
          <label>Source</label>
          <div className="source-tabs">
            {(["single","multi","folder"] as SourceMode[]).map((s) => (
              <button key={s} className={"source-tab" + (sourceMode === s ? " active" : "")}
                onClick={() => { const el = bodyRef.current; const top = el?.scrollTop ?? 0; setSourceMode(s); setFiles([]); setFolder(""); requestAnimationFrame(() => { if (el) el.scrollTop = top; }); }}>
                {{ single: "Single file", multi: "Multiple files", folder: "Folder" }[s]}
              </button>
            ))}
          </div>
          <div className="source-panel">
            {sourceMode === "single" && (
              <div className="path-row">
                <input type="text" readOnly placeholder="No file selected" value={files[0] ?? ""} />
                <button className="btn btn-secondary btn-sm" onClick={handlePickSingle}>Browse</button>
              </div>
            )}
            {sourceMode === "multi" && (
              <>
                <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} onClick={handlePickMulti}>+ Add files</button>
                <div className="file-list">
                  {files.length === 0
                    ? <div className="file-list-empty">No files added</div>
                    : files.map((f) => (
                      <div key={f} className="file-item">
                        <span className="file-item-name">{fileName(f)}</span>
                        <button className="file-item-remove" onClick={() => removeFile(f)}>×</button>
                      </div>
                    ))
                  }
                </div>
              </>
            )}
            {sourceMode === "folder" && (
              <div className="path-row">
                <input type="text" readOnly placeholder="No folder selected" value={folder} />
                <button className="btn btn-secondary btn-sm" onClick={handlePickFolder}>Browse</button>
              </div>
            )}
          </div>
        </div>

        {/* Output dir */}
        <div className="field-group">
          <label>Output folder <span style={{ color: "var(--text2)", fontWeight: 400, textTransform: "none" }}>(optional — defaults to same as input)</span></label>
          <div className="path-row">
            <input type="text" placeholder="Same as input" value={outDir}
              onChange={(e) => { setOutDir(e.target.value); setSetting("convOutDir", e.target.value); }} />
            <button className="btn btn-secondary btn-sm" onClick={handlePickOutDir}>Browse</button>
            {outDir && <button className="btn btn-secondary btn-sm" onClick={() => { setOutDir(""); setSetting("convOutDir", ""); }}>✕</button>}
          </div>
        </div>

        {/* Converter type tabs */}
        <div className="field-group">
          <div className="source-tabs">
            <button className={"source-tab" + (tab === "format" ? " active" : "")} onClick={() => { const el = bodyRef.current; const top = el?.scrollTop ?? 0; setTab("format"); requestAnimationFrame(() => { if (el) el.scrollTop = top; }); }}>Format conversion</button>
            <button className={"source-tab" + (tab === "codec"  ? " active" : "")} onClick={() => { const el = bodyRef.current; const top = el?.scrollTop ?? 0; setTab("codec"); requestAnimationFrame(() => { if (el) el.scrollTop = top; }); }}>Codec conversion</button>
          </div>

          {tab === "format" && (
            <div className="source-panel" style={{ gap: 14 }}>
              <div className="field-group" style={{ gap: 6 }}>
                <label>Video formats</label>
                <div className="btn-group">
                  {VIDEO_FORMATS.map((f) => (
                    <button key={f.id}
                      className={"btn btn-sm " + (targetFormat === f.id ? "btn-primary" : "btn-secondary")}
                      onClick={() => setTargetFormat(f.id)}>{f.label}</button>
                  ))}
                </div>
              </div>
              <div className="field-group" style={{ gap: 6 }}>
                <label>Audio formats</label>
                <div className="btn-group">
                  {AUDIO_FORMATS.map((f) => (
                    <button key={f.id}
                      className={"btn btn-sm " + (targetFormat === f.id ? "btn-primary" : "btn-secondary")}
                      onClick={() => setTargetFormat(f.id)}>{f.label}</button>
                  ))}
                </div>
              </div>
              <div className="field-group" style={{ gap: 6 }}>
                <label>Quality</label>
                <div className="btn-group">
                  {QUALITY_PRESETS.map((q) => (
                    <button key={q.id} title={q.desc}
                      className={"btn btn-sm " + (quality === q.id ? "btn-primary" : "btn-secondary")}
                      onClick={() => setQuality(q.id)}>{q.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "codec" && (
            <div className="source-panel" style={{ gap: 14 }}>
              <div className="field-group" style={{ gap: 6 }}>
                <label>Codec mode</label>
                <div className="mode-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                  {CODEC_MODES.slice(0, 4).map((m) => (
                    <button key={m.id} title={m.desc}
                      className={"mode-btn" + (codecMode === m.id ? " selected" : "")}
                      onClick={() => setCodecMode(m.id)}>
                      <span className="mode-name">{m.name}</span>
                      <span className="mode-sub">{m.sub}</span>
                    </button>
                  ))}
                </div>
                <div className="mode-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  {CODEC_MODES.slice(4).map((m) => (
                    <button key={m.id} title={m.desc}
                      className={"mode-btn" + (codecMode === m.id ? " selected" : "")}
                      onClick={() => setCodecMode(m.id)}>
                      <span className="mode-name">{m.name}</span>
                      <span className="mode-sub">{m.sub}</span>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text1)", minHeight: 16 }}>
                  {CODEC_MODES.find((m) => m.id === codecMode)?.desc}
                </div>
              </div>
              {(codecMode === "h264" || codecMode === "h265") && (
                <div className="field-group" style={{ gap: 6 }}>
                  <label>
                    Quality (CRF) <span style={{ color: "var(--accent2)", fontWeight: 700 }}>{crf}</span>
                    <span style={{ color: "var(--text2)", fontWeight: 400, textTransform: "none", marginLeft: 8 }}>
                      {crf <= 18 ? "visually lossless" : crf <= 23 ? "high quality" : crf <= 28 ? "balanced" : "small file"}
                    </span>
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 10, color: "var(--text2)" }}>best</span>
                    <input type="range" min={12} max={36} value={crf}
                      onChange={(e) => setCrf(Number(e.target.value))} style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: "var(--text2)" }}>smallest</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="status-row">
          <div className="btn-group">
            {!isRunning ? (
              <button className="btn btn-primary" onClick={handleRun} disabled={!hasInput}>▶ Convert</button>
            ) : (
              <button className="btn btn-danger" onClick={cancel}>■ Cancel</button>
            )}
          </div>
          <div className={"status-pill " + state.status}>
            {isRunning && <span className="pulse" />}
            {statusLabel[state.status] ?? "Ready"}
          </div>
        </div>

        <LogOutput lines={state.lines} onClear={clearLines} />
      </div>
    </div>
  );
}
