import { useState, useEffect, useRef } from "react";
import { pickFolder, pickFiles, getScriptPath } from "../lib/dialog";
import { getSetting, setSetting } from "../lib/store";
import { runCommand, type CancelHandle } from "../lib/runner";
import LogOutput, { classifyLine, type LogLine } from "../components/LogOutput";

const MODES = [
  { id: "clip",    name: "Clip",    sub: "ProRes Proxy",  desc: "Small file size, fast exports. Good for rough cuts and proxy editing." },
  { id: "edit",    name: "Edit",    sub: "ProRes 422",    desc: "Balanced quality/size for everyday editing. Default choice." },
  { id: "color",   name: "Color",   sub: "ProRes 422 HQ", desc: "Higher data rate for heavy color grading." },
  { id: "main",    name: "Main",    sub: "DNxHR HQ",      desc: "Avid-native codec. Bitrate auto-selected based on resolution and frame rate." },
  { id: "quality", name: "Quality", sub: "ProRes 4444",   desc: "Archival quality with alpha channel support. Largest file size." },
] as const;

type ModeId = (typeof MODES)[number]["id"];
type SourceMode = "single" | "multi" | "folder";
type Status = "idle" | "running" | "done" | "error";

const VIDEO_EXTS = ["mp4","mkv","mov","avi","webm","m4v","flv","ts","mts"];

export default function Converter() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("single");
  const [files, setFiles]     = useState<string[]>([]);
  const [folder, setFolder]   = useState("");
  const [outDir, setOutDir]   = useState("");
  const [mode, setMode]       = useState<ModeId>("edit");
  const [lines, setLines]     = useState<LogLine[]>([]);
  const [status, setStatus]   = useState<Status>("idle");
  const cancelRef = useRef<CancelHandle | null>(null);

  useEffect(() => {
    getSetting<string>("convOutDir", "").then(setOutDir);
  }, []);

  const addLine = (raw: string) => {
    if (raw.trim()) setLines((p) => [...p, classifyLine(raw)]);
  };

  const handlePickSingle = async () => {
    const sel = await pickFiles(VIDEO_EXTS);
    if (sel && sel.length > 0) setFiles([sel[0]]);
  };

  const handlePickMulti = async () => {
    const sel = await pickFiles(VIDEO_EXTS);
    if (sel) setFiles((prev) => [...new Set([...prev, ...sel])]);
  };

  const handlePickFolder = async () => {
    const sel = await pickFolder();
    if (sel) setFolder(sel);
  };

  const handlePickOutDir = async () => {
    const sel = await pickFolder();
    if (sel) { setOutDir(sel); setSetting("convOutDir", sel); }
  };

  const removeFile = (path: string) => setFiles((prev) => prev.filter((f) => f !== path));
  const fileName   = (path: string) => path.split(/[\\/]/).pop() ?? path;

  const handleRun = async () => {
    const hasInput = sourceMode === "folder" ? !!folder : files.length > 0;
    if (!hasInput) return;
    setLines([]);
    setStatus("running");

    const scriptPath = await getScriptPath("scripts/convert.py");
    const args: string[] = [scriptPath, "--mode", mode];
    if (sourceMode === "folder") args.push("--folder", folder);
    else args.push("--files", ...files);
    if (outDir) args.push("--outdir", outDir);

    const pythonCmd = (await getSetting<string>("pythonPath", "")) || "python3";

    const handle = runCommand(pythonCmd, args, {
      onLine: addLine,
      onDone: (code) => {
        if (code === null) { addLine("[WARN] Cancelled."); setStatus("idle"); }
        else if (code === 0) { addLine("[DONE] All conversions complete."); setStatus("done"); }
        else { addLine(`[ERROR] Exited with code ${code}`); setStatus("error"); }
        cancelRef.current = null;
      },
    });
    cancelRef.current = handle;
  };

  const handleCancel = () => { cancelRef.current?.cancel(); cancelRef.current = null; };
  const hasInput = sourceMode === "folder" ? !!folder : files.length > 0;
  const statusLabel: Record<Status, string> = { idle: "Ready", running: "Converting…", done: "Done", error: "Error" };

  return (
    <div className="tab">
      <div className="tab-header">
        <h1>Converter</h1>
        <p>Convert video files to ProRes or DNxHR using ffmpeg</p>
      </div>
      <div className="tab-body">

        <div className="field-group">
          <label>Source</label>
          <div className="source-tabs">
            {(["single","multi","folder"] as SourceMode[]).map((s) => (
              <button key={s} className={"source-tab" + (sourceMode === s ? " active" : "")}
                onClick={() => { setSourceMode(s); setFiles([]); setFolder(""); }}>
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

        <div className="field-group">
          <label>Output folder <span style={{ color: "var(--text2)", fontWeight: 400, textTransform: "none" }}>(optional — defaults to same as input)</span></label>
          <div className="path-row">
            <input type="text" placeholder="Same as input" value={outDir}
              onChange={(e) => { setOutDir(e.target.value); setSetting("convOutDir", e.target.value); }} />
            <button className="btn btn-secondary btn-sm" onClick={handlePickOutDir}>Browse</button>
            {outDir && <button className="btn btn-secondary btn-sm" onClick={() => { setOutDir(""); setSetting("convOutDir", ""); }}>✕</button>}
          </div>
        </div>

        <div className="field-group">
          <label>Codec mode</label>
          <div className="mode-grid">
            {MODES.map((m) => (
              <button key={m.id} title={m.desc} className={"mode-btn" + (mode === m.id ? " selected" : "")} onClick={() => setMode(m.id)}>
                <span className="mode-name">{m.name}</span>
                <span className="mode-sub">{m.sub}</span>
              </button>
            ))}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text1)", marginTop: 4, minHeight: 16 }}>
            {MODES.find((m) => m.id === mode)?.desc}
          </div>
        </div>

        <div className="status-row">
          <div className="btn-group">
            <button className="btn btn-primary" onClick={handleRun} disabled={status === "running" || !hasInput}>▶ Convert</button>
            {status === "running" && <button className="btn btn-danger" onClick={handleCancel}>■ Cancel</button>}
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
