// ---------- formatting (all times shown in UK local time; January = GMT)

const TZ = "Europe/London";
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const shortDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });

export const fmtTime = (t: string | number) => timeFmt.format(new Date(t));
export const fmtDateTime = (t: string | number) => dateTimeFmt.format(new Date(t));
export const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
export const fmtShortDay = (t: string | number) => shortDayFmt.format(new Date(t));

export const fmtMW = (v: number | null | undefined, digits = 0) =>
  v == null ? "–" : `${v.toLocaleString("en-GB", { maximumFractionDigits: digits })}`;
export const fmtGW = (v: number | null | undefined, digits = 1) =>
  v == null ? "–" : (v / 1000).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtSignedGW = (v: number | null | undefined) =>
  v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtGW(Math.abs(v))}`;
export const compactMW = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}k` : `${v}`;
export const fmtGWh = (mwh: number | null | undefined) => (mwh == null ? "–" : (mwh / 1000).toFixed(0));

// Shared Recharts chrome so every chart looks the same.
export const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--text-muted)", fontSize: 12 },
  tickLine: false,
} as const;
export const gridProps = { stroke: "var(--grid)", vertical: false } as const;
