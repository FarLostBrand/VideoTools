import { useState, useEffect } from "react";
import type React from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "../lib/store";

interface PathFieldProps {
  label: string;
  settingKey: string;
  placeholder: string;
  hint: string;
}

function PathField({ label, settingKey, placeholder, hint }: PathFieldProps) {
  const [val, setVal] = useState("");
  useEffect(() => { getSetting<string>(settingKey, "").then(setVal); }, [settingKey]);
  const save = (v: string) => { setVal(v); setSetting(settingKey, v); };
  return (
    <div className="field-group">
      <label>{label}</label>
      <input type="text" placeholder={placeholder} value={val} onChange={(e) => save(e.target.value)} />
      <span style={{ fontSize: "10.5px", color: "var(--text2)" }}>{hint}</span>
    </div>
  );
}

type UpdateStatus = "idle" | "checking" | "available" | "none" | "installing" | "error";

export default function Settings({ bodyRef }: { bodyRef: React.RefObject<HTMLDivElement> }) {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState("");

  const checkUpdate = async () => {
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const version = await invoke<string | null>("check_for_update");
      if (version) {
        setUpdateVersion(version);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("none");
      }
    } catch (e) {
      setUpdateError(String(e));
      setUpdateStatus("error");
    }
  };

  const installUpdate = async () => {
    setUpdateStatus("installing");
    try {
      await invoke("install_update");
    } catch (e) {
      setUpdateError(String(e));
      setUpdateStatus("error");
    }
  };

  const updateLabel: Record<UpdateStatus, string> = {
    idle:       "Check for updates",
    checking:   "Checking…",
    available:  `Update to v${updateVersion}`,
    none:       "You're up to date",
    installing: "Installing…",
    error:      "Check failed",
  };

  return (
    <div className="tab">
      <div className="tab-header">
        <h1>Settings</h1>
        <p>Tool paths and defaults — all settings auto-save</p>
      </div>
      <div className="tab-body" ref={bodyRef}>

        {/* Updates */}
        <div className="settings-section">
          <h2>Updates</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className={"btn " + (updateStatus === "available" ? "btn-primary" : "btn-secondary")}
              disabled={updateStatus === "checking" || updateStatus === "installing"}
              onClick={updateStatus === "available" ? installUpdate : checkUpdate}
            >
              {updateStatus === "checking" || updateStatus === "installing"
                ? <><span className="pulse" style={{ display: "inline-block", marginRight: 6 }} />{updateLabel[updateStatus]}</>
                : updateLabel[updateStatus]
              }
            </button>
            {updateStatus === "none" && (
              <span style={{ fontSize: 11.5, color: "var(--green)" }}>✓ Already on the latest version</span>
            )}
            {updateStatus === "error" && (
              <span style={{ fontSize: 11.5, color: "var(--red)" }}>{updateError}</span>
            )}
          </div>
        </div>

        {/* Downloader */}
        <div className="settings-section">
          <h2>Downloader</h2>
          <PathField label="Default download folder" settingKey="dlDir"
            placeholder="(Downloads folder)" hint="Where yt-dlp saves files when no folder is set in the Downloader tab." />
          <PathField label="yt-dlp path" settingKey="ytdlpPath"
            placeholder="yt-dlp  (must be on PATH)" hint="Override if yt-dlp is not on your PATH. Example: /usr/local/bin/yt-dlp" />
        </div>

        {/* Converter */}
        <div className="settings-section">
          <h2>Converter</h2>
          <PathField label="Default output folder" settingKey="convOutDir"
            placeholder="(same as input)" hint="Overrides the default output location for converted files." />
          <PathField label="Python path" settingKey="pythonPath"
            placeholder="python3  (must be on PATH)" hint="Override if python3 is not on your PATH. Example: /usr/bin/python3" />
          <PathField label="ffmpeg path" settingKey="ffmpegPath"
            placeholder="ffmpeg  (must be on PATH)" hint="Override if ffmpeg is not on your PATH. Example: /opt/homebrew/bin/ffmpeg" />
        </div>

        {/* Requirements */}
        <div className="settings-section">
          <h2>Requirements</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { tool: "yt-dlp",  install: "pip install yt-dlp  or  brew install yt-dlp" },
              { tool: "ffmpeg",  install: "brew install ffmpeg  or  dnf install ffmpeg" },
              { tool: "ffprobe", install: "Included with ffmpeg" },
              { tool: "python3", install: "python.org  or  brew install python" },
            ].map(({ tool, install }) => (
              <div key={tool} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                <code style={{
                  background: "var(--bg3)", border: "1px solid var(--border)",
                  borderRadius: 4, padding: "2px 8px", fontSize: 11.5,
                  color: "var(--accent2)", minWidth: 80, textAlign: "center",
                }}>
                  {tool}
                </code>
                <span style={{ fontSize: 11.5, color: "var(--text1)" }}>{install}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
