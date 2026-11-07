import Link from "next/link";
import { api, type Skill, type Run } from "@/lib/api";

export const dynamic = "force-dynamic";

async function load(): Promise<{ skills: Skill[]; runs: Run[]; error?: string }> {
  try {
    const [skills, runs] = await Promise.all([api.skills(), api.runs()]);
    return { skills, runs };
  } catch (e: any) {
    return { skills: [], runs: [], error: e.message };
  }
}

export default async function Home() {
  const { skills, runs, error } = await load();
  return (
    <>
      <h1>Skills</h1>
      {error && <div className="banner">API unreachable: {error}. Start it with <span className="mono">uv run uvicorn cerebral.api:app --port 8000</span></div>}
      {!error && skills.length === 0 && <p className="muted">No skills yet. <Link href="/demo">Record a demonstration</Link> to create one.</p>}
      <div className="steps">
        {skills.map((s) => {
          const mine = runs.filter((r) => r.skill_id === s.id);
          const ok = mine.filter((r) => r.status === "succeeded").length;
          return (
            <Link key={s.id} href={`/skills/${s.id}`} className="step">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div><strong>{s.name}</strong> <span className="muted">v{s.version} · {s.site} · {s.steps.length} steps</span></div>
                <div className="row">
                  <span className="pill">{mine.length} runs</span>
                  <span className={`pill ${ok === mine.length && mine.length ? "ok" : ""}`}>{ok} verified</span>
                </div>
              </div>
              <div className="muted">{s.goal}</div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
