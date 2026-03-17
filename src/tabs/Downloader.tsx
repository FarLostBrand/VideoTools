import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickFolder } from "../lib/dialog";
import { getSetting, setSetting } from "../lib/store";
import { runCommand, type RunOptions } from "../lib/runner";
import LogOutput, { classifyLine, type LogLine } from "../components/LogOutput";

const PRESETS = [
  { label: "Best",  args: "-f bestvideo+bestaudio/best",                  title: "Best available quality" },
  { label: "MP4",   args: "-f bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4", title: "Force MP4 container" },
  { label: "1080p", args: "-f bestvideo[height<=1080]+bestaudio/best",    title: "Cap at 1080p" },
  { label: "720p",  args: "-f bestvideo[height<=720]+bestaudio/best",     title: "Cap at 720p" },
  { label: "MP3",   args: "-x --audio-format mp3 --audio-quality 0",     title: "Extract audio as MP3" },
  { label: "WAV",   args: "-x --audio-format wav",                        title: "Extract audio as WAV" },
];

type Status = "idle" | "running" | "done" | "error";

export default function Downloader() {
  const [url, setUrl]               = useState("");
  const [outDir, setOutDir]         = useState("");
  const [defaultDir, setDefaultDir] = useState("~");
  const [customArgs, setCustomArgs] = useState("");
  const [preset, setPreset]         = useState<string | null>(null);
  const [lines, setLines]           = useState<LogLine[]>([]);
  const [status, setStatus]         = useState<Status>("idle");
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    getSetting<string>("dlDir", "").then(setOutDir);
    getSetting<string>("dlCustomArgs", "").then(setCustomArgs);
    invoke<string>("get_cwd").then(setDefaultDir).catch(() => setDefaultDir("~"));
  }, []);

  const handlePickFolder = async () => {
    const selected = await pickFolder();
    if (selected) {
      setOutDir(selected);
      setSetting("dlDir", selected);
    }
  };

  const addLine = (raw: string) => {
    if (raw.trim()) setLines((prev) => [...prev, classifyLine(raw)]);
  };

  const buildArgs = (): string[] => {
    const args: string[] = [];
    if (outDir) args.push("-o", `${outDir}/%(title)s.%(ext)s`);
    const allExtra = [preset, customArgs.trim()].filter(Boolean).join(" ");
    if (allExtra) {
      const parts = allExtra.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
      if (parts) args.push(...parts);
    }
    args.push(url.trim());
    return args;
  };

  const handleRun = () => {
    if (!url.trim()) return;
    setLines([]);
    setStatus("running");
    const { cancel } = runCommand("yt-dlp", buildArgs(), {
      onLine: addLine,
      onDone: (code) => {
        if (code === null)      { addLine("[WARN] Cancelled.");                    setStatus("idle");  }
        else if (code === 0)    { addLine("[DONE] Download complete.");            setStatus("done");  }
        else                    { addLine(`[ERROR] yt-dlp exited with code ${code}`); setStatus("error"); }
        cancelRef.current = null;
      },
    } as RunOptions);
    cancelRef.current = cancel;
  };

  const handleCancel = () => { cancelRef.current?.(); cancelRef.current = null; };

  const statusLabel: Record<Status, string> = {
    idle: "Ready", running: "Downloading…", done: "Done", error: "Error",
  };

  return (
    <div className="tab">
      <div className="tab-header">
        <h1>Downloader</h1>
        <p>Download video or audio using yt-dlp</p>
      </div>
      <div className="tab-body">

        <div className="field-group">
          <label>URL</label>
          <input type="url" placeholder="https://youtube.com/watch?v=…" value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && status !== "running" && handleRun()} />
        </div>

        <div className="field-group">
          <label>Output folder</label>
          <div className="path-row">
            <input
              type="text"
              placeholder={defaultDir}
              value={outDir}
              onChange={(e) => { setOutDir(e.target.value); setSetting("dlDir", e.target.value); }}
            />
            <button className="btn btn-secondary btn-sm" onClick={handlePickFolder}>Browse</button>
            {outDir && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setOutDir(""); setSetting("dlDir", ""); }}>✕</button>
            )}
          </div>
        </div>

        <div className="field-group">
          <label>
            Format preset{" "}
            <span style={{ color: "var(--text2)", fontWeight: 400, textTransform: "none" }}>
              (none = yt-dlp default)
            </span>
          </label>
          <div className="btn-group">
            {PRESETS.map((p) => (
              <button key={p.label} title={p.title}
                className={"btn btn-sm " + (preset === p.args ? "btn-primary" : "btn-secondary")}
                onClick={() => setPreset(preset === p.args ? null : p.args)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-group">
          <label>Custom arguments</label>
          <textarea rows={3} placeholder={"--write-thumbnail\n--convert-subs srt\n--embed-chapters"}
            value={customArgs}
            onChange={(e) => { setCustomArgs(e.target.value); setSetting("dlCustomArgs", e.target.value); }} />
        </div>

        <div className="status-row">
          <div className="btn-group">
            <button className="btn btn-primary" onClick={handleRun} disabled={status === "running" || !url.trim()}>
              ▶ Download
            </button>
            {status === "running" && (
              <button className="btn btn-danger" onClick={handleCancel}>■ Cancel</button>
            )}
          </div>
          <div className={"status-pill " + status}>
            {status === "running" && <span className="pulse" />}
            {statusLabel[status]}
          </div>
        </div>

        <LogOutput lines={lines} onClear={() => setLines([])} />
      </div>
    </div>
  );
}
