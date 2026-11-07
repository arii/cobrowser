// The page that opens when you stop recording: review the captured steps, name the skill, state its
// goal in one sentence, and hand the demonstration to the API, which derives the skill.
import type { Recording, Skill } from "./background.js";
import type { Settings } from "./settings.js";

type State = { rec: Recording | null; settings: Settings };

const app = document.getElementById("app")!;
const send = <T,>(msg: unknown) => chrome.runtime.sendMessage(msg) as Promise<T>;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function render(state: State) {
  const { rec, settings } = state;
  if (!rec) {
    app.innerHTML = `<h1>Nothing to teach</h1><p class="muted">Press the Cerebral button on a page to start a demonstration.</p>`;
    return;
  }
  const host = (() => { try { return new URL(rec.site).hostname; } catch { return rec.site; } })();
  const steps = rec.actions.map((a, i) => `
    <li><strong>${esc(a.description || a.kind)}</strong><span class="pill">${a.kind}</span>
      ${a.target ? `<div class="mono">${esc(a.target)}</div>` : ""}
      ${a.kind === "type" && a.value ? `<div class="mono">“${esc(a.value)}”</div>` : ""}
    </li>`).join("");
  app.innerHTML = `
    <h1>Teach the agent</h1>
    <p class="muted">You demonstrated ${rec.actions.length} step${rec.actions.length === 1 ? "" : "s"} on ${esc(host)}${rec.phase === "recording" ? " (still recording)" : ""}.
      Name the skill and say what being done looks like. The agent derives checks for every step from what the page did.</p>
    ${rec.error ? `<p class="err">${esc(rec.error)}</p>` : ""}
    <label>Skill name</label>
    <input id="name" value="${esc(`${host} demonstration`)}" placeholder="Add a widget to the cart">
    <label>Goal, in one sentence</label>
    <input id="goal" placeholder="The cart shows one Widget">
    <div class="row">
      <button id="learn" ${rec.actions.length === 0 ? "disabled" : ""}>Teach the agent</button>
      <button id="discard" class="ghost">Discard</button>
      <span id="status" class="muted"></span>
    </div>
    <section>
      <h2 style="font-size:15px;margin:0">Recorded steps</h2>
      ${rec.actions.length ? `<ol>${steps}</ol>` : `<p class="muted">No steps were captured. Did you interact with the page after pressing the button?</p>`}
    </section>
    <p class="muted" style="margin-top:28px;font-size:13px">API: ${esc(settings.apiUrl)} · <a href="options.html" target="_blank">settings</a></p>`;

  const status = document.getElementById("status")!;
  document.getElementById("learn")!.addEventListener("click", async () => {
    const name = (document.getElementById("name") as HTMLInputElement).value.trim();
    const goal = (document.getElementById("goal") as HTMLInputElement).value.trim();
    (document.getElementById("learn") as HTMLButtonElement).disabled = true;
    status.textContent = "Deriving skill…";
    const r = await send<{ skill?: Skill; error?: string }>({ type: "finish", name, goal });
    if (r.error || !r.skill) {
      status.innerHTML = `<span class="err">${esc(r.error ?? "unknown error")}</span>`;
      (document.getElementById("learn") as HTMLButtonElement).disabled = false;
      return;
    }
    const link = `${settings.webUrl}/skills/${r.skill.id}`;
    app.innerHTML = `
      <h1 class="ok">Learned: ${esc(r.skill.name)}</h1>
      <p class="muted">${r.skill.steps.length} step${r.skill.steps.length === 1 ? "" : "s"}, each with derived pre- and postconditions. The agent can now run it alone and prove every run.</p>
      <ol>${r.skill.steps.map((s) => `<li>${esc(s.name)}</li>`).join("")}</ol>
      <div class="row"><a href="${esc(link)}"><button>Open the skill</button></a><span class="mono">${esc(r.skill.id)}</span></div>`;
  });
  document.getElementById("discard")!.addEventListener("click", async () => {
    await send({ type: "discard" });
    render({ rec: null, settings });
  });
}

send<State>({ type: "state" }).then(render, (e) => { app.innerHTML = `<p class="err">${esc(String(e))}</p>`; });
