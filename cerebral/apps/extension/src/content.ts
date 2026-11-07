// Content script: the page-side sensor. Injected only into the tab being recorded, re-injected on
// every navigation of that tab. It installs the shared page script (packages/page-capture) in the
// content-script world, forwards raw DOM-level events to the service worker, and answers snapshot
// requests. Idempotent: the service worker may inject it more than once per document.
import { installPageCapture, RECORD_BINDING } from "../../../packages/page-capture/src/page.js";
import type { PageSnapshot, RawEvent } from "../../../packages/page-capture/src/types.js";

type W = Window & { [RECORD_BINDING]?: (ev: RawEvent) => void; __cerebralPage?: { snapshot(): PageSnapshot }; __cerebralContentInstalled?: boolean };
const w = window as W;

if (!w.__cerebralContentInstalled) {
  w.__cerebralContentInstalled = true;
  w[RECORD_BINDING] = (ev: RawEvent) => {
    chrome.runtime.sendMessage({ type: "raw", ev }).catch(() => { /* service worker restarting; event dropped */ });
  };
  installPageCapture(RECORD_BINDING);
  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, reply) => {
    if (msg?.type === "snapshot") {
      reply(w.__cerebralPage ? w.__cerebralPage.snapshot() : null);
    }
    return false;
  });
}
