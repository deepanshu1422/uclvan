import { useState, type ReactNode } from "react";

// ---------- small presentational pieces

export function Tile(props: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; hero?: boolean }) {
  return (
    <div className={`tile${props.hero ? " hero" : ""}`}>
      <div className="label">{props.label}</div>
      <div className="value">
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </div>
      {props.sub && <div className="sub">{props.sub}</div>}
    </div>
  );
}

export function Card(props: { title: string; sub?: ReactNode; children: ReactNode; table?: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{props.title}</h2>
          {props.sub && <p className="card-sub">{props.sub}</p>}
        </div>
        {props.table && (
          <button className="linkish" onClick={() => setShowTable((s) => !s)}>
            {showTable ? "Show chart" : "Show table"}
          </button>
        )}
      </div>
      {showTable ? <div className="table-wrap">{props.table}</div> : props.children}
    </section>
  );
}

export type LegendItem = { label: string; color: string; kind?: "line" | "box" };

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.kind === "box" ? "box" : ""} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export type TooltipRow = { label: string; color: string; value: string };

export function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="tt">
      <div className="tt-title">{title}</div>
      {rows.map((r) => (
        <div className="tt-row" key={r.label}>
          <i style={{ background: r.color }} />
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}
