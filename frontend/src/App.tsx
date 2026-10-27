import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "./api";
import { fmtDateTime } from "./format";
import { useApi } from "./useApi";
import { Accuracy } from "./pages/Accuracy";
import { DecisionDesk } from "./pages/DecisionDesk";

type Tab = "decision" | "accuracy";
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "decision", label: "1 · Plan a purchase", hint: "Which wind number to buy against" },
  { id: "accuracy", label: "2 · How accurate is the forecast?", hint: "Quantified error, January 2026" },
];

// View state lives in the URL so any view can be shared as a link.
function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return { tab: (p.get("view") === "accuracy" ? "accuracy" : "decision") as Tab, day: p.get("day"), gate: p.get("gate") };
}

export default function App() {
  const meta = useApi(() => api.meta(), []);
  const init = readUrl();
  const [tab, setTab] = useState<Tab>(init.tab);
  const [day, setDay] = useState<string | null>(init.day);
  const [gate, setGate] = useState<string | null>(init.gate);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ decision: null, accuracy: null });

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);

  const m = meta.data;
  const activeDay = m ? (day && m.delivery_days.includes(day) ? day : m.delivery_days[13]) : null;
  const activeGate = gate ?? m?.default_gate ?? "09:20";

  useEffect(() => {
    if (!activeDay) return;
    const p = new URLSearchParams({ view: tab, day: activeDay, gate: activeGate });
    window.history.replaceState(null, "", `?${p}`);
  }, [tab, activeDay, activeGate]);

  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;

  // WAI-ARIA tabs pattern: arrow keys move between tabs, Home/End jump to the ends.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "ArrowRight" ? (i + 1) % TABS.length
      : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? TABS.length - 1
      : null;
    if (next == null) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <div className="brand">
          <h1>Wind Decision Desk</h1>
          <span>How much wind can we count on tomorrow, and how wrong can the forecast be? · GB · January 2026 pilot</span>
        </div>
        <button
          className="theme-btn"
          aria-pressed={dark}
          aria-label="Dark mode"
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          {dark ? "☀ Light" : "☾ Dark"}
        </button>
      </header>

      <nav aria-label="Views">
        <div className="tabs" role="tablist" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
          >
            <span className="tab-label">{t.label}</span>
            <span className="tab-hint">{t.hint}</span>
          </button>
        ))}
        </div>
      </nav>

      <main id="main" tabIndex={-1}>
        <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {meta.error && <div className="error" role="alert">Could not reach the API: {meta.error}</div>}
        {!m && !meta.error && <p className="status" role="status">Loading January 2026 wind data…</p>}
        {m && activeDay && (tab === "decision" ? (
          <DecisionDesk meta={m} day={activeDay} setDay={setDay} gate={activeGate} setGate={setGate} />
        ) : (
          <Accuracy meta={m} gate={activeGate} />
        ))}
        </div>
      </main>

      {m && (
        <footer>
          Data: Elexon BMRS — FUELHH (wind outturn, half-hourly) and WINDFOR (wind forecast, hourly, {m.forecast_publishes} issues).
          Source: {m.source}, fetched {fmtDateTime(m.fetched_at)}. All times UK local. ·{" "}
          <a href="/api/docs">API docs</a>
        </footer>
      )}
    </div>
  );
}
