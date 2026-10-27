import { useMemo } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type Decision, type Meta } from "../api";
import { Card, Explainer, Glossary, Legend, Takeaway, Tile, TooltipBox } from "../components";
import { axisProps, compactMW, fmtDateTime, fmtDay, fmtGW, fmtGWh, fmtMW, fmtSignedGW, fmtTime, gridProps } from "../format";
import { useApi } from "../useApi";

const C = {
  actual: "var(--series-actual)",
  forecast: "var(--series-forecast)",
  p50: "var(--series-p50)",
  vintage: "var(--vintage)",
};

type Row = { t: number; forecast?: number | null; p50?: number | null; band?: [number, number] | null; actual?: number | null };

function mergeRows(d: Decision): Row[] {
  const rows = new Map<number, Row>();
  for (const p of d.points) {
    const t = Date.parse(p.t);
    rows.set(t, {
      t,
      forecast: p.forecast,
      p50: p.p50,
      band: p.p10 != null && p.p90 != null ? [p.p10, p.p90] : null,
    });
  }
  for (const a of d.actuals_halfhourly) {
    const t = Date.parse(a.t);
    rows.set(t, { ...(rows.get(t) ?? { t }), actual: a.value });
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function DecisionDesk(props: { meta: Meta; day: string; setDay: (d: string) => void; gate: string; setGate: (g: string) => void }) {
  const { meta, day, setDay, gate, setGate } = props;
  const { data, error, loading } = useApi(() => api.decision(day, gate), [day, gate]);
  const idx = meta.delivery_days.indexOf(day);

  return (
    <>
      <Explainer storageKey="decision" title="How to use this page (30 seconds)">
        <ol className="steps">
          <li><b>Pick the delivery day</b> you are buying power for, and the time you make the decision on the day before (default 09:20, around day-ahead gate closure).</li>
          <li><b>Read the green recommendation box.</b> It gives the wind level to plan against, so the gap to demand can be bought day-ahead or from thermal plant.</li>
          <li><b>Check the chart.</b> Orange is the forecast you had at decision time, the green band is the realistic range, and blue is what actually happened (hindsight).</li>
        </ol>
        <Glossary />
      </Explainer>

      <div className="filters" role="group" aria-label="Choose delivery day and decision time">
        <div className="field">
          <label htmlFor="day">Delivery day</label>
          <span className="stepper">
            <button aria-label="Previous delivery day" disabled={idx <= 0} onClick={() => setDay(meta.delivery_days[idx - 1])}>‹</button>
            <select id="day" value={day} onChange={(e) => setDay(e.target.value)}>
              {meta.delivery_days.map((d) => (
                <option key={d} value={d}>{fmtDay(d)}</option>
              ))}
            </select>
            <button aria-label="Next delivery day" disabled={idx >= meta.delivery_days.length - 1} onClick={() => setDay(meta.delivery_days[idx + 1])}>›</button>
          </span>
        </div>
        <div className="field">
          <label htmlFor="gate">Decision time (day before, UK)</label>
          <input id="gate" type="time" value={gate} onChange={(e) => e.target.value && setGate(e.target.value)} />
        </div>
      </div>

      {error && <div className="error" role="alert">Could not load decision data: {error}</div>}
      {data && <DecisionBody d={data} loading={loading} />}
    </>
  );
}

function DecisionBody({ d, loading }: { d: Decision; loading: boolean }) {
  const rows = useMemo(() => mergeRows(d), [d]);
  const vintage = useMemo(() => {
    const byT = new Map<number, Record<string, number | null>>();
    d.vintages.forEach((v, i) => {
      for (const p of v.points) {
        const t = Date.parse(p.t);
        byT.set(t, { ...(byT.get(t) ?? { t }), [`v${i}`]: p.value });
      }
    });
    for (const a of d.actuals_halfhourly) {
      const t = Date.parse(a.t);
      byT.set(t, { ...(byT.get(t) ?? { t }), actual: a.value });
    }
    return [...byT.values()].sort((a, b) => (a.t as number) - (b.t as number));
  }, [d]);
  const chosen = d.vintages.findIndex((v) => v.publish_time === d.publish_time);

  const avgF = mean(d.points.map((p) => p.forecast));
  const avgP10 = mean(d.points.map((p) => p.p10));
  const avgP50 = mean(d.points.map((p) => p.p50));
  const avgA = mean(d.actuals_halfhourly.map((p) => p.value));
  const qLo = Math.round(d.band.q_low * 100);
  // Difference of the rounded figures shown in the tiles, so the sentence and the tiles agree.
  const cover = avgF != null && avgP10 != null ? (Math.round(avgF / 100) - Math.round(avgP10 / 100)) * 100 : null;
  const coverGWh =
    d.summary.forecast_mwh != null && d.summary.p10_mwh != null ? fmtGWh(d.summary.forecast_mwh - d.summary.p10_mwh) : null;
  // band.mid is the median of (actual - forecast); flip sign to express it as forecast - actual like everywhere else.
  const janBias = d.band.mid != null ? -d.band.mid : null;
  const qHi = Math.round(d.band.q_high * 100);

  const ticks = d.points.filter((_, i) => i % 3 === 0).map((p) => Date.parse(p.t));
  const xAxis = (
    <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={ticks} tickFormatter={fmtTime} {...axisProps} />
  );
  const yAxis = <YAxis tickFormatter={compactMW} width={44} {...axisProps} />;

  return (
    <div className={loading ? "loading" : ""} aria-busy={loading}>
      <Takeaway title={`Recommendation for ${fmtDay(d.delivery_date)}`}>
        <p>
          Plan on <strong>{fmtGW(avgP10)} GW</strong> of wind (day average), not the raw forecast of {fmtGW(avgF)} GW.
          {cover != null && cover > 0 && <> Secure roughly <strong>{fmtGW(cover)} GW more</strong> from the day-ahead market or thermal
          plant than the raw forecast implies{coverGWh != null && <> (about <strong>{coverGWh} GWh</strong> over the day)</>}.</>}
        </p>
        <p className="takeaway-why">
          Why: in January the forecast typically (median) ran {fmtSignedGW(janBias)} GW above the wind that actually arrived. At the P{qLo} level,
          actual wind came in higher {100 - qLo}% of the time, so this level leaves the desk short only rarely.
        </p>
      </Takeaway>

      <p className="lede">
        To buy power for <strong>{fmtDay(d.delivery_date)}</strong>, the decision is taken at{" "}
        <strong>{fmtDateTime(d.decision_time)}</strong>. The latest wind forecast available then was published{" "}
        <strong>{d.publish_time ? fmtDateTime(d.publish_time) : "–"}</strong>, covering the day{" "}
        {d.horizon_min_h}–{d.horizon_max_h} hours ahead.
      </p>

      <div className="tiles">
        <Tile hero label={`Wind to plan against (P${qLo}), day average`} value={fmtGW(avgP10)} unit="GW"
          sub={`In January, actual wind beat this level ${100 - qLo}% of the time. Cover the rest with thermal.`} />
        <Tile label="Latest forecast, day average" value={fmtGW(avgF)} unit="GW"
          sub={`Range ${fmtGW(d.summary.min_forecast_mw)}–${fmtGW(d.summary.max_forecast_mw)} GW`} />
        <Tile label="Bias-adjusted (P50)" value={fmtGW(avgP50)} unit="GW" sub="Forecast plus January's median error" />
        <Tile label="Hindsight: actual, day average" value={fmtGW(avgA)} unit="GW"
          sub={<>Forecast error {fmtSignedGW(d.summary.bias)} GW · MAE {fmtGW(d.summary.mae)} GW</>} />
      </div>

      <Card
        title="Forecast at decision time vs what happened"
        sub={`Wind generation, MW. Hourly forecast with P${qLo}–P${qHi} range from January's decision-time errors (${d.band.n} hours); actual half-hourly outturn shown for hindsight.`}
        table={<HourlyTable d={d} />}
        summary={`Line chart for ${fmtDay(d.delivery_date)}. Forecast at decision time averages ${fmtGW(avgF)} GW, bias-adjusted P50 ${fmtGW(avgP50)} GW, plan level P${qLo} ${fmtGW(avgP10)} GW, actual ${fmtGW(avgA)} GW. Use "Show as table" for hourly values.`}
      >
        <Legend items={[
          { label: "Forecast at decision time", color: C.forecast },
          { label: "Bias-adjusted P50", color: C.p50, kind: "dash" },
          { label: `P${qLo}–P${qHi} range`, color: C.p50, kind: "box" },
          { label: "Actual (hindsight)", color: C.actual },
        ]} />
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            {xAxis}
            {yAxis}
            <Tooltip
              cursor={{ stroke: "var(--axis)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as Row;
                return (
                  <TooltipBox title={fmtDateTime(label as number)} rows={[
                    ...(r.forecast != null ? [{ label: "forecast", color: C.forecast, value: `${fmtMW(r.forecast)} MW` }] : []),
                    ...(r.p50 != null ? [{ label: "P50", color: C.p50, value: `${fmtMW(r.p50)} MW` }] : []),
                    ...(r.band ? [{ label: `P${qLo}–P${qHi}`, color: C.p50, value: `${fmtGW(r.band[0])}–${fmtGW(r.band[1])} GW` }] : []),
                    ...(r.actual != null ? [{ label: "actual", color: C.actual, value: `${fmtMW(r.actual)} MW` }] : []),
                  ]} />
                );
              }}
            />
            <Area dataKey="band" stroke="none" fill={C.p50} fillOpacity={0.14} connectNulls isAnimationActive={false} />
            <Line dataKey="p50" stroke={C.p50} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="forecast" stroke={C.forecast} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="actual" stroke={C.actual} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card
        title="How the forecast for this day evolved"
        sub={`Wind generation, MW. ${d.vintages.length} forecast publishes covered this day. The highlighted one is what the desk saw at decision time; grey lines are earlier and later issues.`}
        summary={`Line chart of ${d.vintages.length} successive forecast issues for ${fmtDay(d.delivery_date)}, with the one used at decision time highlighted and the actual outturn.`}
      >
        <Legend items={[
          { label: "Forecast used at decision time", color: C.forecast },
          { label: "Other forecast issues", color: C.vintage },
          { label: "Actual", color: C.actual },
        ]} />
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={vintage} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            {xAxis}
            {yAxis}
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip
              cursor={{ stroke: "var(--axis)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as Record<string, number | null>;
                const vals = d.vintages.map((_, i) => r[`v${i}`]).filter((x): x is number => x != null);
                return (
                  <TooltipBox title={fmtDateTime(label as number)} rows={[
                    ...(chosen >= 0 && r[`v${chosen}`] != null ? [{ label: "used at decision", color: C.forecast, value: `${fmtMW(r[`v${chosen}`])} MW` }] : []),
                    ...(vals.length ? [{ label: "range of all issues", color: C.vintage, value: `${fmtGW(Math.min(...vals))}–${fmtGW(Math.max(...vals))} GW` }] : []),
                    ...(r.actual != null ? [{ label: "actual", color: C.actual, value: `${fmtMW(r.actual)} MW` }] : []),
                  ]} />
                );
              }}
            />
            {d.vintages.map((v, i) =>
              i === chosen ? null : (
                <Line key={v.publish_time} dataKey={`v${i}`} stroke={C.vintage} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
              ),
            )}
            {chosen >= 0 && (
              <Line dataKey={`v${chosen}`} stroke={C.forecast} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
            )}
            <Line dataKey="actual" stroke={C.actual} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function HourlyTable({ d }: { d: Decision }) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th scope="col">Hour (UK)</th><th scope="col" className="num">Lead (h)</th><th scope="col" className="num">Forecast MW</th>
          <th scope="col" className="num">P{Math.round(d.band.q_low * 100)} MW</th><th scope="col" className="num">P50 MW</th>
          <th scope="col" className="num">P{Math.round(d.band.q_high * 100)} MW</th><th scope="col" className="num">Actual MW</th><th scope="col" className="num">Error MW</th>
        </tr>
      </thead>
      <tbody>
        {d.points.map((p) => (
          <tr key={p.t}>
            <td>{fmtTime(p.t)}</td>
            <td className="num">{p.horizon_h}</td>
            <td className="num">{fmtMW(p.forecast)}</td>
            <td className="num">{fmtMW(p.p10)}</td>
            <td className="num">{fmtMW(p.p50)}</td>
            <td className="num">{fmtMW(p.p90)}</td>
            <td className="num">{fmtMW(p.actual)}</td>
            <td className="num">{p.forecast != null && p.actual != null ? fmtMW(p.forecast - p.actual) : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
