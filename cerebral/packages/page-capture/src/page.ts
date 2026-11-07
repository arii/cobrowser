// The page-side half of demonstration capture, shared by the browser worker (injected with
// Playwright's addInitScript) and the Chrome extension (run as a content script).
//
// Two jobs, one algorithm:
//   snapshot()  walks the live DOM and reports the accessibility tree as (role, name, value) nodes,
//               plus visible text. The Python side hashes (url path, sorted (role, name)) pairs, so
//               the demonstration (captured by the extension) and the replay (captured by the worker)
//               MUST compute names and roles identically. That is why this is one function.
//   listeners   capture-phase click / input / change / keydown handlers that resolve the element the
//               human touched to the same (role, name) anchor and report it through `bindingName`.
//
// installPageCapture is deliberately self-contained (no references to module scope) so that
// `installPageCapture.toString()` can be shipped into a page as source text.
import type { CaptureStats, PageSnapshot, RawEvent } from "./types.js";

export const RECORD_BINDING = "__cerebralRecord";
export const PAGE_GLOBAL = "__cerebralPage";

export type PageCaptureApi = { snapshot(): PageSnapshot };

export function installPageCapture(bindingName: string): void {
  const w = window as unknown as Record<string, unknown>;
  const MAX_NODES = 2000;
  const MAX_TEXT = 20000;
  const NAME_MAX = 80;

  const IGNORED_ROLES: Record<string, 1> = { generic: 1, none: 1, presentation: 1 };
  const SKIP_TAGS: Record<string, 1> = { script: 1, style: 1, noscript: 1, template: 1, svg: 1, head: 1, meta: 1, link: 1 };
  const INPUT_ROLES: Record<string, string> = {
    button: "button", submit: "button", reset: "button", image: "button", checkbox: "checkbox", radio: "radio",
    range: "slider", number: "spinbutton", search: "searchbox", email: "textbox", tel: "textbox", url: "textbox",
    password: "textbox", text: "textbox", date: "textbox", time: "textbox", "datetime-local": "textbox", month: "textbox", week: "textbox",
  };
  const TAG_ROLES: Record<string, string> = {
    button: "button", select: "combobox", textarea: "textbox", summary: "button", option: "option", optgroup: "group",
    h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", img: "img", li: "listitem",
    ul: "list", ol: "list", menu: "list", nav: "navigation", main: "main", header: "banner", footer: "contentinfo",
    form: "form", table: "table", tr: "row", td: "cell", th: "columnheader", thead: "rowgroup", tbody: "rowgroup", tfoot: "rowgroup",
    dialog: "dialog", article: "article", section: "region", aside: "complementary", fieldset: "group", details: "group",
    hr: "separator", progress: "progressbar", output: "status", datalist: "listbox", figure: "figure", search: "search",
  };
  // Roles whose accessible name may come from their content (ARIA 1.2 "name from content").
  const NAME_FROM_CONTENT: Record<string, 1> = {
    button: 1, cell: 1, checkbox: 1, columnheader: 1, gridcell: 1, heading: 1, link: 1, menuitem: 1, menuitemcheckbox: 1,
    menuitemradio: 1, option: 1, radio: 1, rowheader: 1, switch: 1, tab: 1, tooltip: 1, treeitem: 1,
  };
  const INTERACTIVE: Record<string, 1> = {
    button: 1, link: 1, checkbox: 1, radio: 1, combobox: 1, tab: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1,
    option: 1, switch: 1, textbox: 1, searchbox: 1, slider: 1, spinbutton: 1, treeitem: 1, listbox: 1,
  };
  const NON_TEXT_INPUTS: Record<string, 1> = { button: 1, submit: 1, reset: 1, image: 1, checkbox: 1, radio: 1, file: 1, range: 1, color: 1, hidden: 1 };
  const VALUE_ROLES: Record<string, 1> = { textbox: 1, searchbox: 1, combobox: 1, spinbutton: 1, slider: 1 };

  const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  const inputType = (el: Element) => (el.getAttribute("type") || "text").toLowerCase();
  const tagOf = (el: Element) => el.tagName.toLowerCase();
  const textOf = (el: Element) => clean((el as HTMLElement).innerText || el.textContent);

  function role(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = tagOf(el);
    if (tag === "input") return INPUT_ROLES[inputType(el)] || "textbox";
    if (tag === "a" || tag === "area") return el.hasAttribute("href") ? "link" : "";
    if (tag === "img") return clean(el.getAttribute("alt")) ? "img" : "presentation";
    if (tag === "select") {
      const s = el as HTMLSelectElement;
      return s.multiple || s.size > 1 ? "listbox" : "combobox";
    }
    if ((el as HTMLElement).isContentEditable && !TAG_ROLES[tag]) return "textbox";
    return TAG_ROLES[tag] || "";
  }

  function name(el: Element, r: string): string {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? textOf(n) : ""; }).join(" "));
      if (t) return t;
    }
    const label = clean(el.getAttribute("aria-label"));
    if (label) return label;
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) { const t = textOf(labels[0]); if (t) return t; }
    const tag = tagOf(el);
    if (tag === "input") {
      const ty = inputType(el);
      if (ty === "button" || ty === "submit" || ty === "reset") return clean((el as HTMLInputElement).value);
      if (ty === "image") return clean(el.getAttribute("alt"));
    }
    if (tag === "img" || tag === "area") return clean(el.getAttribute("alt"));
    if (tag === "fieldset") { const lg = el.querySelector("legend"); if (lg) return textOf(lg); }
    if (tag === "figure") { const fc = el.querySelector("figcaption"); if (fc) return textOf(fc); }
    if (tag === "table") { const cp = el.querySelector("caption"); if (cp) return textOf(cp); }
    const ph = clean(el.getAttribute("placeholder"));
    if (ph) return ph;
    const title = clean(el.getAttribute("title"));
    if (title) return title;
    if (tag === "select" || tag === "textarea" || tag === "input") return "";
    if (NAME_FROM_CONTENT[r]) {
      const t = textOf(el);
      if (t) return t;
      const img = el.querySelector("img[alt], [aria-label]");
      if (img) return clean(img.getAttribute("alt") || img.getAttribute("aria-label"));
    }
    return "";
  }

  /** The element and everything inside it are out of the tree. */
  function pruned(el: Element): boolean {
    if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return true;
    return tagOf(el) === "input" && inputType(el) === "hidden";
  }

  /** The element itself is rendered. False for display:none and visibility:hidden, but ALSO for any element
   *  without a box, such as a `display: contents` wrapper: those have no rects, and checkVisibility() reports
   *  them as not visible even though everything inside them is on screen. */
  function visible(el: Element): boolean {
    const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    if (typeof cv === "function") return cv.call(el, { checkVisibilityCSS: true, visibilityProperty: true });
    return el.getClientRects().length > 0;
  }

  /** Not rendered itself, but its children may be (display: contents). Only asked about invisible elements. */
  function boxless(el: Element): boolean {
    return getComputedStyle(el).display === "contents";
  }

  // Widget state for stateful roles, so a toggled checkbox, an opened disclosure or a selected tab
  // changes the node (and therefore the snapshot hash) even though its role and name do not.
  function state(el: Element, r: string): string {
    const aria = (k: string) => el.getAttribute(k);
    if (r === "checkbox" || r === "radio" || r === "switch" || r === "menuitemcheckbox" || r === "menuitemradio") {
      const input = el as HTMLInputElement;
      const checked = aria("aria-checked") ?? (typeof input.checked === "boolean" ? String(input.checked) : null);
      return checked === null ? "" : checked === "mixed" ? "mixed" : checked === "true" ? "checked" : "unchecked";
    }
    if (r === "tab" || r === "option" || r === "gridcell" || r === "row" || r === "treeitem") {
      const sel = aria("aria-selected") ?? ((el as HTMLOptionElement).selected === true ? "true" : null);
      if (sel !== null) return sel === "true" ? "selected" : "unselected";
    }
    if (r === "button" || r === "combobox" || r === "treeitem" || r === "link") {
      const exp = aria("aria-expanded");
      if (exp !== null) return exp === "true" ? "expanded" : "collapsed";
      const pressed = aria("aria-pressed");
      if (pressed !== null) return pressed === "true" ? "pressed" : "unpressed";
    }
    return "";
  }

  function value(el: Element, r: string): string {
    const st = state(el, r);
    if (st) return st;
    if (!VALUE_ROLES[r]) return "";
    const tag = tagOf(el);
    if (tag === "input" && inputType(el) === "password") return "";
    if (tag === "select") { const s = el as HTMLSelectElement; const o = s.options[s.selectedIndex]; return clean(o ? o.label || o.text : ""); }
    if (tag === "input" || tag === "textarea") return clean(String((el as HTMLInputElement).value ?? ""));
    if ((el as HTMLElement).isContentEditable) return textOf(el);
    return "";
  }

  // Why a tree came out the way it did, for the worker's and the API's logs: an empty tree with thousands
  // of elements scanned and most of them `hidden` points at the visibility rules; `boxless` counts the
  // display:contents wrappers whose subtrees were walked anyway (search.brave.com wraps its whole page in one).
  function tree(): { tree: PageSnapshot["tree"]; capture: CaptureStats } {
    const out: PageSnapshot["tree"] = [];
    const stats: CaptureStats = { scanned: 0, emitted: 0, hidden: 0, boxless: 0, truncated: false };
    const walk = (root: ParentNode) => {
      const kids = root.children;
      for (let i = 0; i < kids.length; i++) {
        if (out.length >= MAX_NODES) { stats.truncated = true; return; }
        const el = kids[i];
        if (SKIP_TAGS[tagOf(el)]) continue;
        stats.scanned++;
        if (pruned(el)) { stats.hidden++; continue; }
        if (!visible(el)) {
          if (!boxless(el)) { stats.hidden++; continue; }  // display:none / visibility:hidden: whole subtree is out
          stats.boxless++;  // no box of its own: not a node, but its children are rendered, so walk them
        } else {
          const r = role(el);
          if (r && !IGNORED_ROLES[r]) {
            const n = name(el, r);
            if (n || r === "button" || r === "link") { out.push({ role: r, name: n, value: value(el, r) }); stats.emitted++; }
          }
        }
        if (el.shadowRoot) walk(el.shadowRoot);
        walk(el);
      }
    };
    if (document.body) walk(document.body);
    return { tree: out, capture: stats };
  }

  if (!w.__cerebralPage) {
    w.__cerebralPage = {
      snapshot(): PageSnapshot {
        const t = tree();
        return {
          url: location.href,
          title: document.title || "",
          tree: t.tree,
          text: (document.body ? document.body.innerText || "" : "").slice(0, MAX_TEXT),
          capture: t.capture,
        };
      },
    };
  }
  if (w.__cerebralRecorderInstalled) return;
  w.__cerebralRecorderInstalled = true;

  // A click lands on whatever is under the cursor: a span inside a button, an img inside a link.
  // Climb to the nearest interactive ancestor; fall back to the first element with any role.
  function interactive(start: Element | null): Element | null {
    let first: Element | null = null;
    let n: Element | null = start;
    for (let i = 0; n && n !== document.body && i < 8; i++) {
      const r = role(n);
      if (r && INTERACTIVE[r]) return n;
      if (r && !IGNORED_ROLES[r] && !first) first = n;
      n = n.parentElement;
    }
    return first;
  }
  const isField = (el: Element) => {
    const t = tagOf(el);
    return t === "textarea" || (el as HTMLElement).isContentEditable || (t === "input" && !NON_TEXT_INPUTS[inputType(el)]);
  };
  const send = (ev: RawEvent) => { try { (w[bindingName] as (e: RawEvent) => void)(ev); } catch { /* host not ready */ } };
  const anchorOf = (el: Element) => { const r = role(el); return { role: r, name: name(el, r) }; };
  const targetEl = (e: Event): Element | null => {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const first = path.length ? path[0] : e.target;
    return first instanceof Element ? first : null;
  };

  document.addEventListener("click", (e) => {
    const el = interactive(targetEl(e));
    if (!el || isField(el)) return; // focusing a text field is not a step; the typing that follows is
    const a = anchorOf(el);
    send({ type: "click", role: a.role, name: a.name });
  }, true);
  document.addEventListener("input", (e) => {
    const el = targetEl(e);
    if (!el || !isField(el)) return;
    const secret = tagOf(el) === "input" && inputType(el) === "password";
    const a = anchorOf(el);
    const v = secret ? "" : (el as HTMLElement).isContentEditable ? textOf(el) : String((el as HTMLInputElement).value ?? "");
    send({ type: "input", role: a.role, name: a.name, value: v, secret });
  }, true);
  document.addEventListener("change", (e) => {
    const el = targetEl(e);
    if (!el || tagOf(el) !== "select") return;
    const s = el as HTMLSelectElement;
    const opt = s.options[s.selectedIndex];
    send({ type: "select", name: name(el, role(el)), value: clean(opt ? opt.label || opt.text || opt.value : s.value) });
  }, true);
  document.addEventListener("keydown", (e) => {
    const el = targetEl(e);
    const tag = el ? tagOf(el) : "";
    if (e.key === "Enter" && tag !== "textarea" && !(el && (el as HTMLElement).isContentEditable)) send({ type: "key", key: "Enter" });
    if (e.key === "Escape") send({ type: "key", key: "Escape" });
  }, true);
}

/**
 * Source text of installPageCapture, for hosts that inject code into a page (Playwright addInitScript/evaluate).
 * Bundlers that keep function names (esbuild's keepNames, which tsx enables) rewrite inner declarations to
 * `__name(fn, "fn")`; the wrapper supplies that helper so the stringified function runs anywhere.
 */
export const PAGE_CAPTURE_SOURCE = `((__name) => (${installPageCapture.toString()}))((f) => f)`;

/** Statement that installs capture in a page, reporting to `bindingName`. */
export function pageCaptureInstaller(bindingName: string = RECORD_BINDING): string {
  return `${PAGE_CAPTURE_SOURCE}(${JSON.stringify(bindingName)})`;
}
