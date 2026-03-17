import { useEffect, useRef } from "react";

export interface LogLine {
  text: string;
  type: "info" | "done" | "error" | "start" | "progress" | "warn";
}

export function classifyLine(raw: string): LogLine {
  const t = raw.trim();
  if (t.startsWith("[DONE]"))     return { text: t, type: "done" };
  if (t.startsWith("[START]"))    return { text: t, type: "start" };
  if (t.startsWith("[ERROR]"))    return { text: t, type: "error" };
  if (t.startsWith("[PROGRESS]")) return { text: t, type: "progress" };
  if (t.startsWith("[WARN]"))     return { text: t, type: "warn" };
  return { text: t, type: "info" };
}

interface Props {
  lines: LogLine[];
  onClear: () => void;
}

export default function LogOutput({ lines, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="log-wrap">
      <div className="log-header">
        <span className="log-label">Output</span>
        <button className="btn btn-secondary btn-sm" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="log-output">
        {lines.length === 0 ? (
          <span style={{ color: "var(--text2)" }}>— ready —</span>
        ) : (
          lines.map((l, i) => (
            <span key={i} className={`log-line ${l.type}`}>
              {l.text}
              {"\n"}
            </span>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
