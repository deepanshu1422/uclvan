import { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type Accuracy as AccuracyData, type HorizonRow, type Meta } from "../api";
import { Card, Legend, Tile, TooltipBox } from "../components";
import { axisProps, compactMW, fmtDateTime, fmtDay, fmtGW, fmtMW, fmtShortDay, fmtSignedGW, gridProps } from "../format";
import { useApi } from "../useApi";

const C = {
  actual: "var(--series-actual)",
  forecast: "var(--series-forecast)",
  p50: "var(--series-p50)",
  bar: "var(--series-actual)",
};

type Mode = "decision" | "horizon";

export function Accuracy({ meta, gate }: { meta: Meta; gate: string }) {
  const days = meta.delivery_days;
  const [mode, setMode] = useState<Mode>("decision");
  const [horizon, setHorizon] = useState(24);
  const [start, setStart] = useState(days[0]);
  const [end, setEnd] = useState(days[days.length - 1]);

  const acc = useApi(() => api.accuracy({ mode, horizon_h: horizon, gate, start, end }), [mode, horizon, gate, start, end]);
  const hz = useApi(() => api.horizons(start, end), [start, end]);

  return (
    <>
      <div className="filters">
        <label className="field">
          From
          <select value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }}>
            {days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
          </select>
        </label>
        <label className="field">
          To
          <select value={end} onChange={(e) => { setEnd(e.target.value); if (e.target.value < start) setStart(e.target.value); }}>
            {days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
          </select>
        </label>
        <div className="field">
          Forecast evaluated
          <div className="seg" role="group">
            <button aria-pressed={mode === "decision"} onClick={() => setMode("decision")}>At decision time ({gate})</button>
            <button aria-pressed={mode === "horizon"} onClick={() => setMode("horizon")}>Fixed lead time</button>
          </div>
        </div>
        {mode === "horizon" && (
          <label className="field">
            Lead time: {horizon} h before delivery
            <input type="range" min={0} max={meta.max_horizon_h} value={horizon} onChange={(e) => setHorizon(+e.target.value)} />
          </label>
        )}
      </div>

      {acc.error && <div className="error">Could not load accuracy data: {acc.error}</div>}
      {acc.data && <AccuracyBody a={acc.data} loading={acc.loading} horizons={hz.data} />}
    </>
  );
}

function AccuracyBody({ a, loading, horizons }: { a: AccuracyData; loading: boolean; horizons: HorizonRow[] | null }) {
  const m = a.metrics;
  const q = m.quantiles ?? {};
  const series = useMemo(() => a.series.map((s) => ({ ...s, t: Date.parse(s.t) })), [a]);
  const worst = useMemo(() => [...a.by_day].sort((x, y) => (y.mae ?? 0) - (x.mae ?? 0)), [a]);
  const label = a.mode === "decision" ? `the forecast available at ${a.gate} on D-1` : `the forecast issued ${a.horizon_h} h ahead`;

  return (
    <div className={loading ? "loading" : ""}>
      <p className="lede">
        Accuracy of <strong>{label}</strong> over {m.n} delivery hours ({fmtDay(a.start)} – {fmtDay(a.end)}). Error =
        forecast − actual: positive means wind under-delivered and more thermal was needed than planned.
      </p>

      <div className="tiles">
        <Tile hero label="Typical miss (mean absolute error)" value={fmtGW(m.mae, 2)} unit="GW" sub={`${m.nmae_pct}% of average wind output (${fmtGW(m.mean_actual)} GW)`} />
        <Tile label="Bias (mean error)" value={fmtSignedGW(m.bias)} unit="GW" sub={(m.bias ?? 0) > 0 ? "Forecast runs high: plan for less wind" : "Forecast runs low"} />
        <Tile label="RMSE" value={fmtGW(m.rmse, 2)} unit="GW" sub="Penalises large misses" />
        <Tile label="80% of errors within" value={`${fmtSignedGW(q.p10)} / ${fmtSignedGW(q.p90)}`} unit="GW" sub="P10 to P90 of forecast − actual" />
        <Tile label="Hours missed by over 2 GW" value={m.p_abs_err_gt_2gw_pct} unit="%" sub={`Worst hour: ${fmtGW(m.max_abs_error)} GW`} />
      </div>

      <Card
        title="Forecast vs actual, hour by hour"
        sub="Wind generation, MW, per delivery hour. The orange line is the forecast being evaluated."
        table={
          <table className="data">
            <thead><tr><th>Hour (UK)</th><th>Forecast issued</th><th className="num">Forecast MW</th><th className="num">Actual MW</th><th className="num">Error MW</th></tr></thead>
            <tbody>
              {a.series.map((s) => (
                <tr key={s.t}><td>{fmtDateTime(s.t)}</td><td>{s.publish_time ? fmtDateTime(s.publish_time) : "–"}</td>
                  <td className="num">{fmtMW(s.forecast)}</td><td className="num">{fmtMW(s.actual)}</td><td className="num">{fmtMW(s.error)}</td></tr>
              ))}
            </tbody>
          </table>
        }
      >
        <Legend items={[{ label: "Forecast", color: C.forecast }, { label: "Actual", color: C.actual }]} />
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={series} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtShortDay} minTickGap={40} {...axisProps} />
            <YAxis tickFormatter={compactMW} width={44} {...axisProps} />
            <Tooltip
              cursor={{ stroke: "var(--axis)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as (typeof series)[number];
                return (
                  <TooltipBox title={fmtDateTime(label as number)} rows={[
                    { label: "forecast", color: C.forecast, value: `${fmtMW(r.forecast)} MW` },
                    { label: "actual", color: C.actual, value: `${fmtMW(r.actual)} MW` },
                    { label: "error", color: "transparent", value: `${fmtMW(r.error)} MW` },
                  ]} />
                );
              }}
            />
            <Line dataKey="forecast" stroke={C.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="actual" stroke={C.actual} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {horizons && <HorizonCard rows={horizons} />}

      <div className="grid2">
        <Card title="Typical miss by hour of day" sub="Mean absolute error per delivery hour (UK time)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={a.by_hour} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, "0")}`} interval={2} {...axisProps} />
              <YAxis tickFormatter={compactMW} width={44} {...axisProps} />
              <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as AccuracyData["by_hour"][number];
                return <TooltipBox title={`${String(r.hour).padStart(2, "0")}:00`} rows={[
                  { label: "MAE", color: C.bar, value: `${fmtMW(r.mae)} MW` },
                  { label: "bias", color: "transparent", value: `${fmtMW(r.bias)} MW` },
                ]} />;
              }} />
              <Bar dataKey="mae" fill={C.bar} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Error distribution" sub="Hours by forecast − actual, 500 MW bins labelled by lower edge. Right of zero = wind came in below forecast.">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={a.histogram} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="from" tickFormatter={(v) => compactMW(v)} minTickGap={20} {...axisProps} />
              <YAxis width={36} allowDecimals={false} {...axisProps} />
              <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as AccuracyData["histogram"][number];
                return <TooltipBox title={`${fmtMW(r.from)} to ${fmtMW(r.to)} MW`} rows={[{ label: "hours", color: C.bar, value: String(r.count) }]} />;
              }} />
              <Bar dataKey="count" fill={C.bar} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Delivery days ranked by forecast miss" sub="Where the forecast hurt most: use these days to stress-test procurement rules.">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Delivery day</th><th className="num">MAE MW</th><th className="num">Bias MW</th><th className="num">RMSE MW</th><th className="num">Hours</th></tr></thead>
            <tbody>
              {worst.map((r) => (
                <tr key={r.day}><td>{fmtDay(r.day)}</td><td className="num">{fmtMW(r.mae)}</td>
                  <td className={`num ${(r.bias ?? 0) > 0 ? "pos" : "neg"}`}>{fmtMW(r.bias)}</td>
                  <td className="num">{fmtMW(r.rmse)}</td><td className="num">{r.n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function HorizonCard({ rows }: { rows: HorizonRow[] }) {
  const data = rows.map((r) => ({ ...r, band: r.p10 != null && r.p90 != null ? [r.p10, r.p90] : null }));
  return (
    <Card
      title="How error grows with lead time"
      sub="Same delivery hours, forecast taken N hours ahead. Shaded column = lead times the desk actually faces at a D-1 morning decision (~16–40 h)."
      table={
        <table className="data">
          <thead><tr><th className="num">Lead h</th><th className="num">MAE</th><th className="num">RMSE</th><th className="num">Bias</th><th className="num">P10</th><th className="num">P90</th><th className="num">Coverage %</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lead_h}><td className="num">{r.lead_h}</td><td className="num">{fmtMW(r.mae)}</td><td className="num">{fmtMW(r.rmse)}</td>
                <td className="num">{fmtMW(r.bias)}</td><td className="num">{fmtMW(r.p10)}</td><td className="num">{fmtMW(r.p90)}</td><td className="num">{r.coverage_pct}</td></tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Legend items={[
        { label: "Mean absolute error", color: C.actual },
        { label: "Bias (mean error)", color: C.forecast },
        { label: "P10–P90 of error", color: C.forecast, kind: "box" },
      ]} />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <ReferenceArea x1={16} x2={40} fill="var(--surface-2)" fillOpacity={1} />
          <XAxis dataKey="lead_h" type="number" domain={[0, 48]} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} tickFormatter={(v) => `${v}h`} {...axisProps} />
          <YAxis tickFormatter={compactMW} width={44} {...axisProps} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip cursor={{ stroke: "var(--axis)" }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as HorizonRow;
            return <TooltipBox title={`${r.lead_h} h ahead · ${r.n} hours (${r.coverage_pct}% coverage)`} rows={[
              { label: "MAE", color: C.actual, value: `${fmtMW(r.mae)} MW` },
              { label: "bias", color: C.forecast, value: `${fmtMW(r.bias)} MW` },
              { label: "P10–P90", color: C.forecast, value: `${fmtMW(r.p10)} to ${fmtMW(r.p90)} MW` },
            ]} />;
          }} />
          <Area dataKey="band" stroke="none" fill={C.forecast} fillOpacity={0.12} isAnimationActive={false} />
          <Line dataKey="bias" stroke={C.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="mae" stroke={C.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="note">Elexon's furthest forecast issues reach about 43–66 h ahead depending on issue time, so coverage dips beyond ~43 h.</p>
    </Card>
  );
}
