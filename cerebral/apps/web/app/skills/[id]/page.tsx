import { api } from "@/lib/api";
import RunLauncher from "@/components/RunLauncher";

export const dynamic = "force-dynamic";

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [skill, runs] = await Promise.all([api.skill(id), api.runs()]);
  const mine = runs.filter((r) => r.skill_id === id).reverse();
  return (
    <div className="grid">
      <div>
        <h1>{skill.name} <span className="muted">v{skill.version}</span></h1>
        <p className="muted">{skill.goal}</p>
        <div className="steps">
          {skill.steps.map((s, i) => (
            <div key={s.id} className="step">
              <div><span className="muted">{i + 1}.</span> <strong>{s.name}</strong> <span className="pill">{s.action.kind}</span></div>
              {s.action.target && <div className="mono">{s.action.target}</div>}
              <div style={{ marginTop: 6 }}>
                {s.postconditions.map((a) => (
                  <div key={a.id} className="verdict">
                    <span className="pill">{a.kind}</span>
                    <span className="mono" style={{ color: "var(--fg)" }}>{a.expected}</span>
                    <span className="muted" style={{ marginLeft: "auto" }}>{a.source}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>Run</h2>
        <RunLauncher skillId={skill.id} site={skill.site} />
        <h2 style={{ marginTop: 16 }}>History</h2>
        {mine.map((r) => (
          <div key={r.id} className="verdict">
            <a href={`/runs/${r.id}`} className="mono" style={{ color: "var(--fg)" }}>{r.id}</a>
            <span className={`pill ${r.status === "succeeded" ? "ok" : r.status === "awaiting_human" ? "warn" : r.status === "failed" ? "bad" : ""}`}>{r.status}</span>
            <span className="muted" style={{ marginLeft: "auto" }}>{r.interventions} human</span>
          </div>
        ))}
      </div>
    </div>
  );
}
