# Day-miner skill contract (v1, implemented)

Status: implemented by `day-miner/mine.ts` (producer), `apps/extension/skills.js` `skills:import` (consumer) and the
`validOutcome` gate in `skill-learning.js`. Per-step `intent` was added for the intent agent (`Run with intent agent`).

Goal: watch a user for a day, then suggest skills at the end. No task list exists beforehand. A model finds the
tasks in the day's recording and proposes skills. This file defines what a proposed skill must contain for the
existing playback agent (`apps/extension/skills.js`, `perform` + `locate`) to run it.

## What the playback agent needs, derived from the code

| Need | Why | Source |
|---|---|---|
| A start URL per site, http(s), no credentials, up to 8 sites | `perform` opens every site in a new tab and refuses any tab whose origin drifts | `workflowSites`, `checkSite` |
| 1–48 ordered steps, each `click` or `change`, each bound to a site id | The step list is the whole plan; the model never adds actions at run time | `skillIssues`, `perform` |
| On every step a target `{tag, label, type}` that matches **exactly one** visible, enabled control on that page | `locate` matches tag + computed label + type and fails on 0 or 2+ matches, hidden, covered, disabled or sensitive controls | `locate` |
| `click` targets on `BUTTON` or `A`; same-origin links only, no `target=_blank` | A click on an input only focuses it; cross-origin links stop the run | `skillIssues`, `locate` |
| `change` targets on `INPUT`, `SELECT`, `TEXTAREA`, with a parameter slot, never a recorded value | Values are chosen at run time from an override or from the instruction + page text via the input model | `resolveParameter` |
| For each parameter: what it means, so the input model can fill it | The model gets instruction, page text, select options, date and timezone; a description of the slot makes resolution reliable and reduces clarifying questions | `skill-input.ts` system prompt |
| No submit-type control unless the label is export/download/search/filter | Hard rule in both gate and locator | `skillIssues`, `locate` |
| No label matching the risky list (send, pay, buy, delete, publish, transfer, sign out...) | Blocks activation and execution | `riskyAction` |
| A final step whose effect can be observed | After the outcome step the run polls title/headings/excerpt/submission count for a change and fails if nothing changed | `pageResult` |
| Evidence: event ids from the recording that back every step | The library, the brain and the UI cite evidence; a step with no evidence is an invention | `examples`, `evidenceIds` |
| User signed in to the sites beforehand | Replay runs in the user's own profile; it never enters credentials | README |

The one rule the day-miner **changes**: today the last step must be a click whose label starts with a result verb
(`outcomeAction` regex: export, download, preview, search, filter, generate, calculate, run report). A day of real
browsing ends tasks in many other ways (opening the right article, landing on a confirmation page, a filtered list
appearing). The day-miner replaces the verb rule with an explicit, observable **outcome** block (below). The
extension side needs one additive change: accept `skill.outcome` in place of the regex in `skillIssues`, and treat
the last step as the outcome step in `perform` when `skill.outcome` is present.

## skill.json

```json
{
  "schemaVersion": "dayskill-1",
  "id": "uuid",
  "title": "Search Amazon for a product",
  "summary": "Searches Amazon for a product and opens the first matching result.",
  "whenToUse": "You want to look up an item on Amazon without browsing by category.",
  "sites": [{ "id": "main", "url": "https://www.amazon.com/" }],
  "steps": [
    { "kind": "change", "siteId": "main", "target": { "tag": "INPUT", "label": "Search Amazon", "type": "text" },
      "parameter": { "name": "input_1", "description": "The product to search for, taken from the instruction." },
      "evidence": ["event-id", "event-id"] },
    { "kind": "click", "siteId": "main", "target": { "tag": "BUTTON", "label": "Go", "type": "submit" },
      "evidence": ["event-id"] }
  ],
  "outcome": {
    "kind": "page-changed",
    "description": "A results page for the search term is showing.",
    "check": { "titleIncludes": "Amazon.com :" }
  },
  "examples": [{ "at": "iso", "eventIds": ["..."], "effect": "content-changed" }],
  "evidence": { "sessionIds": ["..."], "day": "2026-11-07", "eventIds": ["..."] },
  "generator": { "provider": "meta-llama", "model": "Llama-4-Maverick-17B-128E-Instruct-FP8", "promptVersion": "day-miner-v1" },
  "judge": { "provider": "subq-snap-1.1", "matchesRecording": 0.97, "outcomeObservable": 0.93 },
  "confidence": 0.88,
  "blockers": []
}
```

Rules:

- `outcome.kind` ∈ `page-changed`, `navigation`, `form-submitted`, `download`. `check` is optional and only ever
  loosens nothing: the run still requires an observed page change after the last step; `check` adds a title or text
  condition the run can report on.
- Every step's `target` and `evidence` must come from recorded events. The miner selects and orders events; code
  materializes targets from them. A target the recording never saw is rejected.
- `parameter.name` keeps the `input_N` form so the existing run UI, overrides and `resolveParameter` work unchanged.
  `description` is new and is passed to the input model alongside the instruction.
- `blockers` is the output of the existing `skillIssues` with the outcome rule swapped for `outcome`. A skill with
  blockers is still written to disk so the model's finding is visible, but it is not importable.
- Skills are suggested, never activated. Import into the library is inactive and still needs the review checkbox.

## Translation to the library shape (`skills.js`)

`steps[].parameter.name → steps[].parameter`, `steps[].evidence → evidenceIds`, `outcome` kept as-is on the
stored skill, `examples` kept, `origin = new URL(sites[0].url).origin`, `qualityVersion = 3`,
`reusability = { reusable: true, confidence, source: "model", reason: summary }`, `learnedBy = "day-miner"`.

## Non-negotiables the miner cannot fix

- Unlabeled clicks (coordinates only) cannot become steps. Live recordings have labels; dataset recordings need the
  labeling pass first.
- A task whose controls change label per visit (for example a product title) is not replayable by exact label match;
  the miner should drop such steps or end the skill before them, and say so in `blockers`.
- Anything behind a login, a CAPTCHA, a payment or a destructive action is out of scope by the existing rules.
