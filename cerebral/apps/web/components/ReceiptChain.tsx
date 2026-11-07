import type { Receipt, Skill, StepRecord, Verdict } from "@/lib/api";

function V({ v }: { v: Verdict }) {
  return (
    <div className="verdict">
      <span className={`pill ${v.status === "passed" ? "ok" : v.status === "failed" ? "bad" : ""}`}>{v.status}</span>
      <span className="pill">{v.kind}</span>
      <span className="muted" title={v.evidence}>{v.method}{v.judge_model ? ` · ${v.judge_model}` : ""}{v.confidence != null ? ` · ${Math.round(v.confidence * 100)}%` : ""}</span>
    </div>
  );
}

export default function ReceiptChain({ receipt, skill }: { receipt: Receipt; skill: Skill | null }) {
  const pending = skill ? skill.steps.slice(receipt.records.length) : [];
  return (
    <div className="steps">
      <div className="mono">genesis {receipt.genesis.slice(0, 16)}…</div>
      {receipt.records.map((r) => (
        <div key={r.link} className={`step ${r.outcome}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{r.index + 1}. {r.step_name}</strong>
            <span className={`pill ${outcomeClass(r.outcome)}`}>{r.outcome}{r.human_corrected && r.outcome !== "human_corrected" ? " · human fixed" : ""}{r.repairs ? ` · ${r.repairs} retry` : ""}</span>
          </div>
          <div className="mono">{r.pre_hash.slice(0, 10)} → {r.post_hash.slice(0, 10)} · link {r.link.slice(0, 10)}</div>
          <div>{r.post_verdicts.map((v) => <V key={v.assertion_id} v={v} />)}</div>
        </div>
      ))}
      {pending.map((s, i) => (
        <div key={s.id} className="step" style={{ opacity: .5 }}>
          <strong>{receipt.records.length + i + 1}. {s.name}</strong> <span className="pill">pending</span>
        </div>
      ))}
      {receipt.goal_verdicts.length > 0 && (
        <div className={`step ${receipt.success ? "passed" : "failed"}`}>
          <strong>Goal</strong>
          {receipt.goal_verdicts.map((v) => <V key={v.assertion_id} v={v} />)}
        </div>
      )}
      {receipt.final_link && <div className="mono">final {receipt.final_link}</div>}
      {receipt.receipt_link && <div className="mono">seal {receipt.receipt_link}</div>}
    </div>
  );
}

// passed and the human's recorded fix are good ends; repaired is a warning; failed attempts and handoffs are red.
function outcomeClass(outcome: StepRecord["outcome"]): string {
  return outcome === "passed" || outcome === "human_corrected" ? "ok" : outcome === "repaired" ? "warn" : "bad";
}
