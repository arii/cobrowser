import type { LedgerPoint } from "@/lib/api";

// Two series on one small SVG: interventions (bars) and assertion pass rate (line). No chart lib needed.
export default function Trend({ series }: { series: LedgerPoint[] }) {
  if (series.length === 0) return null;
  const W = 640, H = 140, pad = 28;
  const n = series.length, bw = Math.max(8, (W - pad * 2) / n - 6);
  const maxI = Math.max(1, ...series.map((p) => p.interventions));
  const x = (i: number) => pad + (i + 0.5) * ((W - pad * 2) / n);
  const yI = (v: number) => H - pad - (v / maxI) * (H - pad * 2);
  const yP = (v: number) => H - pad - v * (H - pad * 2);
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(i)},${yP(p.pass_rate)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="interventions and pass rate per run" style={{ margin: "8px 0" }}>
      <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--line)" />
      {series.map((p, i) => (
        <g key={p.run_id}>
          <rect x={x(i) - bw / 2} y={yI(p.interventions)} width={bw} height={H - pad - yI(p.interventions)} fill={p.success ? "var(--ok)" : "var(--bad)"} opacity=".55" rx="2" />
          <text x={x(i)} y={H - pad + 14} fontSize="10" textAnchor="middle" fill="var(--muted)">v{p.version}</text>
          <text x={x(i)} y={yI(p.interventions) - 4} fontSize="10" textAnchor="middle" fill="var(--fg)">{p.interventions}</text>
        </g>
      ))}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {series.map((p, i) => <circle key={p.run_id} cx={x(i)} cy={yP(p.pass_rate)} r="3" fill="var(--accent)" />)}
      <text x={pad} y={14} fontSize="10" fill="var(--muted)">bars: human interventions · line: assertion pass rate</text>
    </svg>
  );
}
