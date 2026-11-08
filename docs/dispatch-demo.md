# Dispatch demo

Run `pnpm fixture`, then open http://127.0.0.1:3210/dispatch.

This is a synthetic delivery operations workflow for Cobrowser recording and replay. Start recording on this page, then:

1. Filter the delivery queue with **Needs attention**.
2. Review order **DP-1042** (Sunday Flowers).
3. Choose **Maya Chen** in **Assign courier**.
4. Click **Dispatch delivery**.
5. Click **Export manifest**.
6. Check `dispatch-manifest.csv` contains `DP-1042,Sunday Flowers,Maya Chen,Dispatched`.

Use **Reset demo** before replaying the workflow. State is in memory and also resets on reload. Other orders and couriers can be used for variations; search matches order IDs, destinations, and neighborhoods. No real delivery is created. The manifest is generated locally from dispatched orders; it is not an independent verification verdict or skill approval.

The existing reporting fixture remains at `/`.
