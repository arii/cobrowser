"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function RunLauncher({ skillId, site }: { skillId: string; site: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  async function go() {
    setBusy(true); setErr(null);
    try {
      const sessionId = `s_${Math.random().toString(36).slice(2, 10)}`;
      await api.openSession(sessionId, site.startsWith("http") ? site : `https://${site}`);
      const run = await api.startRun(skillId, sessionId);
      sessionStorage.setItem(`session:${run.id}`, sessionId);
      router.push(`/runs/${run.id}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div>
      <button onClick={go} disabled={busy}>{busy ? "Starting…" : "Run autonomously"}</button>
      {err && <p className="mono" style={{ color: "var(--bad)" }}>{err}</p>}
      <p className="muted" style={{ marginTop: 8 }}>Opens a shared session, runs each step, and hands off to you if a postcondition fails.</p>
    </div>
  );
}
