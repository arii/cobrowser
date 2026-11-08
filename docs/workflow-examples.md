# Workflow examples

These examples distinguish existing local demos from workflows to support on real websites.

| Example | Result | Status |
|---|---|---|
| Weekly reporting | Export last week's report for the requested team; verify the downloaded CSV's team, dates and rows. | Local reporting fixture and verifier available; see the README. |
| Delivery dispatch | Filter orders needing attention, assign a courier, dispatch a delivery and export its manifest. | Synthetic local demo; see [Dispatch demo](dispatch-demo.md). |
| AIE Code Summit hackathon networking | Read the guest list, find matching LinkedIn profiles and send connection requests to the selected guests. | Cross-tab demonstration discovery and reusable recipe saving implemented; activation and execution require a networking verifier. |

## AIE Code Summit hackathon → LinkedIn

Example instruction:

> Go through the AIE Code Summit hackathon guest list at the event URL I provide. Search LinkedIn for each guest, using their company, role and event details to identify the right person. Send a connection request to each confidently matched guest. Ask me when the identity is unclear. Skip people I'm already connected with or have already invited, and show me the results with profile links.

Inputs: the event guest-list URL, access to the guest list, a signed-in LinkedIn session, and the guests to include (all visible guests or a specified subset). Add a connection note only when the user supplies one.

Expected flow:

1. Read the guest list across its pages, deduplicate attendees and retain the source details used for matching.
2. Search LinkedIn for each attendee and compare available name, company and role details. A name alone is insufficient when several profiles match.
3. Ask for clarification on ambiguous matches; mark guests with no confident match as unresolved.
4. Open the matched profile and send one connection request. Skip existing connections and pending invitations. Pause on sign-in challenges, invitation limits or unavailable controls.
5. Confirm that the profile shows a pending invitation before marking it sent. If the result is unclear, inspect its state before retrying.
6. Report each guest's name, profile link, outcome (sent, already connected, pending, unresolved or blocked) and reason where applicable.

Acceptance criteria: no requests to ambiguous identities, no duplicate invitations on resume, and every reported send backed by the resulting invitation state. A pending invitation is the successful outcome; acceptance by the recipient is outside the workflow.

## Learn this recipe in the extension

1. Reload the rebuilt extension and turn on **Start learning** in Skills.
2. Visit the guest-list tab (its title or URL should identify guests, attendees or participants). Keep that tab open.
3. In LinkedIn, demonstrate **Connect**, then **Send** or **Send without a note**. The Send action must produce an observed page change. Both tabs must belong to the same recording session, within 30 minutes.
4. Open Skills and refresh examples. The extension suggests **Connect with event guests on LinkedIn** with evidence from both tabs. Describe the intended workflow and click **Save to skills**.
5. Review the saved source addresses, intent and reusable procedure. The recipe survives reloads. It remains inactive until an independent networking verifier is implemented; review and old active flags cannot bypass that gate.

No real networking execution is claimed. Guest pagination, dynamic profile navigation and persistent invitation tracking are requirements stored in the recipe, not an enabled runner. The existing independently verified reporting runner remains unchanged.

Validation: `pnpm build:extension && pnpm verify:networking` demonstrates the workflow in an isolated browser using locally fulfilled guest-list and LinkedIn pages. It checks discovery from real recorded clicks, intent/procedure persistence, and rejection of activation/execution (including forged flags). No real account is used and no real invitations are sent.
