import { useEffect, useState } from "react";
import { api } from "./api";
import { fmtDateTime } from "./format";
import { useApi } from "./useApi";
import { Accuracy } from "./pages/Accuracy";
import { DecisionDesk } from "./pages/DecisionDesk";

type Tab = "decision" | "accuracy";

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

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Wind Decision Desk</h1>
          <span>GB national wind · day-ahead purchasing · January 2026 pilot</span>
        </div>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "decision"} onClick={() => setTab("decision")}>Decision view</button>
          <button role="tab" aria-selected={tab === "accuracy"} onClick={() => setTab("accuracy")}>Forecast accuracy</button>
        </nav>
        <div className="top-right">
          <button className="theme-btn" onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? "Light" : "Dark"} mode</button>
        </div>
      </header>

      {meta.error && <div className="error">Could not reach the API: {meta.error}</div>}
      {m && activeDay && (tab === "decision" ? (
        <DecisionDesk meta={m} day={activeDay} setDay={setDay} gate={activeGate} setGate={setGate} />
      ) : (
        <Accuracy meta={m} gate={activeGate} />
      ))}

      {m && (
        <footer>
          Data: Elexon BMRS — FUELHH (wind outturn, half-hourly) and WINDFOR (wind forecast, hourly, {m.forecast_publishes} issues).
          Source: {m.source}, fetched {fmtDateTime(m.fetched_at)}. Times in UK local time. ·{" "}
          <a href="/api/docs">API docs</a>
        </footer>
      )}
    </div>
  );
}
