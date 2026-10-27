import { useId, useState, type ReactNode } from "react";

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

// Charts are exposed to screen readers as a single image with a text summary;
// every chart card also offers the underlying numbers as a real table.
export function Card(props: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  table?: ReactNode;
  summary?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <section className="card" aria-labelledby={`${id}-t`}>
      <div className="card-head">
        <div>
          <h2 id={`${id}-t`}>{props.title}</h2>
          {props.sub && <p className="card-sub">{props.sub}</p>}
        </div>
        {props.table && (
          <button className="linkish" aria-expanded={showTable} aria-controls={`${id}-body`} onClick={() => setShowTable((s) => !s)}>
            {showTable ? "Show chart" : "Show as table"}
          </button>
        )}
      </div>
      <div id={`${id}-body`}>
        {showTable ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={`${props.title}: data table`}>
            {props.table}
          </div>
        ) : (
          <div role="img" aria-label={props.summary ?? props.title}>
            {props.children}
          </div>
        )}
      </div>
    </section>
  );
}

export type LegendItem = { label: string; color: string; kind?: "line" | "dash" | "box" };

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend" aria-hidden="true">
      {items.map((i) => (
        <span key={i.label}>
          <i
            className={i.kind ?? "line"}
            style={i.kind === "dash" ? { borderColor: i.color } : { background: i.color }}
          />
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

// Plain-language "so what" box shown above the numbers.
export function Takeaway({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="takeaway" aria-label={title}>
      <div className="takeaway-title">{title}</div>
      <div className="takeaway-body">{children}</div>
    </section>
  );
}

// Collapsible "how to read this page" guide. Open by default until the user closes it once.
export function Explainer({ storageKey, title, children }: { storageKey: string; title: string; children: ReactNode }) {
  const key = `explainer:${storageKey}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "closed";
    } catch {
      return true;
    }
  });
  return (
    <details
      className="explainer"
      open={open}
      onToggle={(e) => {
        const isOpen = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(isOpen);
        try {
          localStorage.setItem(key, isOpen ? "open" : "closed");
        } catch {
          /* storage unavailable: keep in-memory state only */
        }
      }}
    >
      <summary>{title}</summary>
      <div className="explainer-body">{children}</div>
    </details>
  );
}

export function Glossary() {
  return (
    <dl className="glossary">
      <div><dt>Forecast</dt><dd>Elexon's national wind generation forecast (WINDFOR), issued about 8 times a day.</dd></div>
      <div><dt>Decision time</dt><dd>When the desk commits to day-ahead purchases: the day before delivery (D-1), by default 09:20 UK time.</dd></div>
      <div><dt>P10 / P50 / P90</dt><dd>Wind levels that actual output beat 90% / 50% / 10% of the time, based on how wrong the forecast was in January.</dd></div>
      <div><dt>MAE</dt><dd>Mean absolute error: the typical size of a miss, ignoring direction.</dd></div>
      <div><dt>Bias</dt><dd>Average of forecast − actual. Positive means the forecast promised more wind than arrived.</dd></div>
      <div><dt>Lead time</dt><dd>How many hours before the delivery hour the forecast was issued.</dd></div>
    </dl>
  );
}
