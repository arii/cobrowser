import { api, type Ledger } from "@/lib/api";
import Trend from "@/components/Trend";

export const dynamic = "force-dynamic";

export default async function EvalPage() {
  let ledger: Ledger | null = null; let error: string | null = null;
  try { ledger = await api.ledger(); } catch (e: any) { error = e.message; }
  const trends = ledger?.trends ?? {};
  return (
    <>
      <h1>Eval ledger</h1>
      <p className="muted">One row per completed run. The chart that matters: human interventions per run, trending to zero as the skill absorbs corrections.</p>
      {error && <div className="banner">API unreachable: {error}</div>}
      {Object.entries(trends).length === 0 && !error && <p className="muted">No completed runs yet.</p>}
      {Object.entries(trends).map(([skillId, t]) => (
        <div className="panel" key={skillId} style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2><a href={`/skills/${skillId}`}>{skillId}</a></h2>
            <span className={`pill ${t.success_rate === 1 ? "ok" : ""}`}>{t.runs} runs · {Math.round(t.success_rate * 100)}% verified success</span>
          </div>
          <Trend series={t.series} />
          <table>
            <thead><tr><th>run</th><th>skill v</th><th>result</th><th>assertions</th><th>human</th><th>self-repair</th><th>judge</th><th>final link</th></tr></thead>
            <tbody>
              {t.series.map((p) => (
                <tr key={p.run_id}>
                  <td><a href={`/runs/${p.run_id}`} className="mono" style={{ color: "var(--fg)" }}>{p.run_id}</a></td>
                  <td>v{p.version}</td>
                  <td><span className={`pill ${p.success ? "ok" : "bad"}`}>{p.success ? "verified" : "failed"}</span></td>
                  <td>{Math.round(p.pass_rate * 100)}%</td>
                  <td>{p.interventions}</td><td>{p.self_repairs}</td><td>{p.judge_calls}</td>
                  <td className="mono">{(ledger!.entries as any[]).find((e) => e.run_id === p.run_id)?.final_link?.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
