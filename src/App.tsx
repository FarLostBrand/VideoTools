import { useState } from "react";
import Downloader from "./tabs/Downloader";
import Converter from "./tabs/Converter";
import Settings from "./tabs/Settings";
import "./App.css";

type Tab = "downloader" | "converter" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "downloader", label: "Downloader", icon: "⬇" },
  { id: "converter",  label: "Converter",  icon: "◈" },
  { id: "settings",   label: "Settings",   icon: "⚙" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("downloader");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">▶</span>
          <span className="logo-text">VideoTools</span>
        </div>
        <nav className="sidebar-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={"nav-btn" + (tab === t.id ? " active" : "")}
              onClick={() => setTab(t.id)}
            >
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="version">v1.0.0</span>
        </div>
      </aside>

      <main className="content">
        {tab === "downloader" && <Downloader />}
        {tab === "converter"  && <Converter />}
        {tab === "settings"   && <Settings />}
      </main>
    </div>
  );
}
