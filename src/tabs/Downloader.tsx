import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickFolder } from "../lib/dialog";
import { getSetting, setSetting } from "../lib/store";
import { useProcess } from "../lib/process";
import LogOutput from "../components/LogOutput";
import type React from "react";

const PRESETS = [
  {
    label: "Best",
    args: "-f bestvideo+bestaudio/best",
    title: "Best available quality",
  },
  {
    label: "MP4",
    args: "-f bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4",
    title: "Force MP4 container",
  },
  {
    label: "1080p",
    args: "-f bestvideo[height<=1080]+bestaudio/best",
    title: "Cap at 1080p",
  },
  {
    label: "720p",
    args: "-f bestvideo[height<=720]+bestaudio/best",
    title: "Cap at 720p",
  },
  {
    label: "MP3",
    args: "-x --audio-format mp3 --audio-quality 0",
    title: "Extract audio as MP3",
  },
  {
    label: "WAV",
    args: "-x --audio-format wav",
    title: "Extract audio as WAV",
  },
];

export default function Downloader({
  bodyRef,
}: {
  bodyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { state, isRunning, start, cancel, clearLines } =
    useProcess("downloader");

  const [url, setUrl] = useState("");
  // null = using default downloads dir, string = user has set a custom path
  const [customDir, setCustomDir] = useState<string | null>(null);
  const [defaultDir, setDefaultDir] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [preset, setPreset] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("get_cwd")
      .then((dir) => {
        setDefaultDir(dir);
        // Only load saved setting if it differs from the default
        getSetting<string>("dlDir", "").then((saved) => {
          if (saved && saved !== dir) setCustomDir(saved);
        });
      })
      .catch(() => {});
    getSetting<string>("dlCustomArgs", "").then(setCustomArgs);
  }, []);

  // The actual directory used for downloading
  const effectiveDir = customDir ?? defaultDir;
  const hasCustomDir = customDir !== null;

  const handlePickFolder = async () => {
    const selected = await pickFolder();
    if (selected) {
      setCustomDir(selected);
      setSetting("dlDir", selected);
    }
  };

  const handleClearDir = () => {
    setCustomDir(null);
    setSetting("dlDir", "");
  };

  const buildArgs = (): string[] => {
    const args: string[] = [];
    if (effectiveDir) args.push("-o", `${effectiveDir}/%(title)s.%(ext)s`);
    const allExtra = [preset, customArgs.trim()].filter(Boolean).join(" ");
    if (allExtra) {
      const parts = allExtra.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
      if (parts) args.push(...parts);
    }
    args.push(url.trim());
    return args;
  };

  const handleRun = () => {
    if (!url.trim() || isRunning) return;
    start("yt-dlp", buildArgs(), false);
  };

  const statusLabel: Record<string, string> = {
    idle: "Ready",
    running: "Downloading…",
    done: "Done",
    error: "Error",
  };

  return (
    <div className="tab">
      <div className="tab-header">
        <h1>Downloader</h1>
        <p>Download video or audio using yt-dlp</p>
      </div>
      <div className="tab-body" ref={bodyRef}>
        <div className="field-group">
          <label>URL</label>
          <input
            type="url"
            placeholder="https://youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isRunning && handleRun()}
          />
        </div>

        <div className="field-group">
          <label>Output folder</label>
          <div className="path-row">
            <input
              type="text"
              placeholder={defaultDir || "~/Downloads"}
              value={hasCustomDir ? customDir! : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  handleClearDir();
                } else {
                  setCustomDir(v);
                  setSetting("dlDir", v);
                }
              }}
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={handlePickFolder}
            >
              Browse
            </button>
            {hasCustomDir && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleClearDir}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="field-group">
          <label>
            Format preset{" "}
            <span
              style={{
                color: "var(--text2)",
                fontWeight: 400,
                textTransform: "none",
              }}
            >
              (none = yt-dlp default)
            </span>
          </label>
          <div className="btn-group">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                title={p.title}
                className={
                  "btn btn-sm " +
                  (preset === p.args ? "btn-primary" : "btn-secondary")
                }
                onClick={() => setPreset(preset === p.args ? null : p.args)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-group">
          <label>Custom arguments</label>
          <textarea
            rows={3}
            placeholder={
              "--write-thumbnail\n--convert-subs srt\n--embed-chapters"
            }
            value={customArgs}
            onChange={(e) => {
              setCustomArgs(e.target.value);
              setSetting("dlCustomArgs", e.target.value);
            }}
          />
        </div>

        <div className="status-row">
          <div className="btn-group">
            {!isRunning ? (
              <button
                className="btn btn-primary"
                onClick={handleRun}
                disabled={!url.trim()}
              >
                ▶ Download
              </button>
            ) : (
              <button className="btn btn-danger" onClick={cancel}>
                ■ Cancel
              </button>
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
