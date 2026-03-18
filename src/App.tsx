import { useState, useRef, useCallback } from "react";
import { ProcessProvider, useProcess } from "./lib/process";
import Downloader from "./tabs/Downloader";
import Converter from "./tabs/Converter";
import Settings from "./tabs/Settings";
import "./App.css";

type Tab = "downloader" | "converter" | "settings";

const TABS: { id: Tab; label: string; icon: string; slot: string }[] = [
  { id: "downloader", label: "Downloader", icon: "⬇", slot: "downloader" },
  { id: "converter", label: "Converter", icon: "◈", slot: "converter" },
  { id: "settings", label: "Settings", icon: "⚙", slot: "" },
];

function NavBtn({
  active,
  slot,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  slot: string;
  label: string;
  icon: string;
  onClick: () => void;
}) {
  const { isRunning } = useProcess(slot || "_none");
  return (
    <button className={"nav-btn" + (active ? " active" : "")} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {slot && isRunning && (
        <span className="nav-running-dot" title="Running" />
      )}
    </button>
  );
}

function AppInner() {
  const [tab, setTab] = useState<Tab>("downloader");

  // Refs to each tab-body so we can reset scroll
  const dlBodyRef = useRef<HTMLDivElement>(null);
  const convBodyRef = useRef<HTMLDivElement>(null);
  const setBodyRef = useRef<HTMLDivElement>(null);

  const bodyRefs: Record<Tab, React.RefObject<HTMLDivElement>> = {
    downloader: dlBodyRef,
    converter: convBodyRef,
    settings: setBodyRef,
  };

  const switchTab = useCallback((t: Tab) => {
    setTab(t);
    // Immediately reset scroll on the target tab's body
    setTimeout(() => {
      const el = bodyRefs[t].current;
      if (el) el.scrollTop = 0;
    }, 0);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">▶</span>
          <span className="logo-text">VideoTools</span>
        </div>
        <nav className="sidebar-nav">
          {TABS.map((t) => (
            <NavBtn
              key={t.id}
              {...t}
              active={tab === t.id}
              onClick={() => switchTab(t.id)}
            />
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="version">v1.1.0</span>
        </div>
      </aside>

      <main className="content">
        <div
          style={{
            display: tab === "downloader" ? "flex" : "none",
            height: "100%",
            flexDirection: "column",
          }}
        >
          <Downloader bodyRef={dlBodyRef} />
        </div>
        <div
          style={{
            display: tab === "converter" ? "flex" : "none",
            height: "100%",
            flexDirection: "column",
          }}
        >
          <Converter bodyRef={convBodyRef} />
        </div>
        <div
          style={{
            display: tab === "settings" ? "flex" : "none",
            height: "100%",
            flexDirection: "column",
          }}
        >
          <Settings bodyRef={setBodyRef} />
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ProcessProvider>
      <AppInner />
    </ProcessProvider>
  );
}
