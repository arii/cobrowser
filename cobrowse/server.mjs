// Minimal /cobrowse preview server (Tier 1 shape).
// Implements the repo-previews app contract: everything under BASE_PATH,
// no root-absolute URLs, bare-path redirect, JSON health endpoint.
// /live/* reverse-proxies the Steel Browser sidecar (viewer + API + websocket)
// so the live browser stays same-origin behind the OAuth gate.
// Zero dependencies: plain Node http.

import http from "node:http";

const BASE_PATH = process.env.BASE_PATH || "/cobrowse";
const PORT = Number(process.env.PORT || "3101");
const HOST = process.env.HOST || "0.0.0.0";
const CDP_BASE_URL = process.env.CDP_BASE_URL || "http://172.18.0.1:9222";
const CDP_PREFIX = `${BASE_PATH}/cdp`;
const AGENT_PREFIX = `${BASE_PATH}/agent`;
const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Co-browse preview</title>
</head>
<body>
<h1>Co-browse preview</h1>
<p>Base path: ${BASE_PATH}</p>
<p>Health: <a href="${BASE_PATH}/api/health">api/health</a></p>
<h2>Live browser</h2>
<p><a href="${BASE_PATH}/view">Open the live browser viewer</a></p>
<iframe src="${BASE_PATH}/view" width="1280" height="860" title="Live browser"></iframe>
<h2>Agent</h2>
<div>
<input id="prompt" type="text" size="60" placeholder="Ask the co-browsing agent…">
<button id="run" type="button">Run</button>
<span id="agent-status">idle</span>
</div>
<div id="handoff" style="display:none">
<p>Agent is waiting for you. Watch the viewer above, do the manual step, then hand back.</p>
<p>Live view: <a id="live-link" href="#">open</a> (<a href="${BASE_PATH}/view">our viewer</a>)</p>
<input id="note" type="text" size="60" placeholder="What you did in the browser">
<button id="handback" type="button">Hand back</button>
</div>
<p id="status">Backend: checking…</p>
<script>
fetch("${BASE_PATH}/api/health").then(function (r) { return r.json(); }).then(function (j) {
  document.getElementById("status").textContent = "Backend: " + j.status +
    ", browser: " + (j.browserUp ? "up (" + (j.browser || "?") + ")" : "down");
}).catch(function () {
  document.getElementById("status").textContent = "Backend unreachable.";
});
</script>
<script>
(function () {
  var API = "${BASE_PATH}/agent";
  var thread = "t-" + Math.random().toString(36).slice(2);
  var statusEl = document.getElementById("agent-status");
  var handoffEl = document.getElementById("handoff");

  function render(j) {
    statusEl.textContent = j.status || "error";
    if (j.status === "WAITING_FOR_COBROWSE_HANDOFF") {
      handoffEl.style.display = "block";
      document.getElementById("live-link").href = j.live_view_url || "#";
    } else {
      handoffEl.style.display = "none";
    }
  }

  document.getElementById("run").addEventListener("click", async function () {
    var prompt = document.getElementById("prompt").value.trim();
    if (!prompt) return;
    statusEl.textContent = "running…";
    handoffEl.style.display = "none";
    try {
      var r = await fetch(API + "/api/sessions/" + thread + "/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt }),
      });
      render(await r.json());
    } catch (e) {
      statusEl.textContent = "request failed";
    }
  });

  document.getElementById("handback").addEventListener("click", async function () {
    var note = document.getElementById("note").value.trim() || "Operator completed manual step.";
    statusEl.textContent = "resuming…";
    try {
      var r = await fetch(API + "/api/sessions/" + thread + "/handback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution_note: note }),
      });
      render(await r.json());
    } catch (e) {
      statusEl.textContent = "request failed";
    }
  });
})();
</script>
</body>
</html>`;

const view = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live browser</title>
</head>
<body>
<div>
<button id="connect" type="button">Connect</button>
<input id="url" type="text" size="60" placeholder="https://example.com">
<button id="go" type="button">Go</button>
<input id="type" type="text" size="40" placeholder="type into focused field">
<span id="status">disconnected</span>
</div>
<canvas id="screen" width="1280" height="800"></canvas>
<script>
(function () {
  var CDP = "${BASE_PATH}/cdp";
  var canvas = document.getElementById("screen");
  var ctx = canvas.getContext("2d");
  var statusEl = document.getElementById("status");
  var ws = null;
  var nextId = 0;
  var pending = {};
  var frameW = 1280;
  var frameH = 800;

  function status(t) { statusEl.textContent = t; }

  function send(method, params) {
    return new Promise(function (resolve) {
      var id = ++nextId;
      pending[id] = resolve;
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }

  function scale(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * (frameW / r.width)),
      y: Math.round((e.clientY - r.top) * (frameH / r.height)),
    };
  }

  async function ensureCursor() {
    await send("Runtime.evaluate", { expression: [
      "(() => {",
      "  if (window.__agentCursorInstalled) return;",
      "  window.__agentCursorInstalled = true;",
      "  var c = document.createElement('div');",
      "  c.id = '__agent_cdp_cursor';",
      "  c.style.cssText = 'position:fixed;top:0;left:0;width:18px;height:18px;border-radius:50%;background:rgba(255,59,48,0.85);border:2px solid #fff;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)';",
      "  document.documentElement.appendChild(c);",
      "  window.__moveAgentCursor = function (x, y) {",
      "    var el = document.getElementById('__agent_cdp_cursor');",
      "    if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; }",
      "  };",
      "})()",
    ].join("\\n") });
  }

  async function connect() {
    status("listing targets…");
    var list = await (await fetch(CDP + "/json/list")).json();
    var page = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === "page") { page = list[i]; break; }
    }
    if (!page) {
      status("opening tab…");
      var created = await (
        await fetch(CDP + "/json/new?about:blank", { method: "PUT" })
      ).json();
      page = created;
    }
    status("attaching…");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = async function () {
      await send("Page.enable");
      await ensureCursor();
      await send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1280 });
      status("live");
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && pending[msg.id]) { pending[msg.id](msg.result); delete pending[msg.id]; return; }
      if (msg.method === "Page.screencastFrame") {
        frameW = msg.params.metadata.deviceWidth || frameW;
        frameH = msg.params.metadata.deviceHeight || frameH;
        var img = new Image();
        img.onload = function () { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
        img.src = "data:image/jpeg;base64," + msg.params.data;
        send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
      }
    };
    ws.onclose = function () { status("disconnected"); };
    ws.onerror = function () { status("connection error"); };
  }

  document.getElementById("connect").addEventListener("click", connect);

  document.getElementById("go").addEventListener("click", async function () {
    var url = document.getElementById("url").value.trim();
    if (!ws || !url) return;
    if (url.indexOf("://") === -1) url = "https://" + url;
    status("navigating…");
    await send("Page.navigate", { url: url });
    status("live");
  });

  canvas.addEventListener("mousedown", async function (e) {
    if (!ws) return;
    var p = scale(e);
    await send("Runtime.evaluate", {
      expression: "window.__moveAgentCursor && window.__moveAgentCursor(" + p.x + ", " + p.y + ")",
    });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  });

  canvas.addEventListener("mousemove", function (e) {
    if (!ws || e.buttons !== 0) return;
    var p = scale(e);
    send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  });

  document.getElementById("type").addEventListener("keydown", async function (e) {
    if (!ws) return;
    if (e.key === "Enter") {
      e.preventDefault();
      var text = e.target.value;
      e.target.value = "";
      if (text) await send("Input.insertText", { text: text });
    }
  });
})();
</script>
</body>
</html>`;

function routeFor(urlPath) {
  if (urlPath === CDP_PREFIX || urlPath.startsWith(`${CDP_PREFIX}/`))
    return { base: CDP_BASE_URL, prefix: CDP_PREFIX };
  if (urlPath === AGENT_PREFIX || urlPath.startsWith(`${AGENT_PREFIX}/`))
    return { base: API_BASE_URL, prefix: AGENT_PREFIX };
  return null;
}

function stripPath(urlPath, prefix) {
  const rest = urlPath.slice(prefix.length) || "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

const PUBLIC_CDP = process.env.PUBLIC_CDP || "https://dev-onasafari.ddns.net:8443/cobrowse/cdp";
const PUBLIC_CDP_WS = PUBLIC_CDP.replace(/^http/, "ws");

const REWRITES = [
  ["ws://172.18.0.1:9222", PUBLIC_CDP_WS],
  ["ws://172.18.0.1", PUBLIC_CDP_WS],
  ["ws://localhost:9222", PUBLIC_CDP_WS],
  ["ws://localhost", PUBLIC_CDP_WS],
];

function rewriteBody(text) {
  let out = text;
  for (const [from, to] of REWRITES) out = out.split(from).join(to);
  return out;
}

async function proxyHttp(req, res) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const route = routeFor(pathname);
  if (!route) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const target = new URL(stripPath(pathname, route.prefix), route.base);
  const { "content-length": _dropped, ...rest } = req.headers;
  const headers = { ...rest, host: target.host, "accept-encoding": "identity" };
  const out = http.request(target, { method: req.method, headers }, (steelRes) => {
    const type = steelRes.headers["content-type"] || "";
    const rewrite =
      type.includes("text/html") ||
      type.includes("javascript") ||
      type.includes("json") ||
      type.includes("css");
    const outHeaders = { ...steelRes.headers };
    for (const h of ["location", "refresh"]) {
      if (typeof outHeaders[h] === "string" && outHeaders[h].startsWith("/")) {
        outHeaders[h] = `${LIVE_PREFIX}${outHeaders[h]}`;
      }
    }
    if (!rewrite) {
      res.writeHead(steelRes.statusCode || 502, outHeaders);
      steelRes.pipe(res);
      return;
    }
    const chunks = [];
    steelRes.on("data", (c) => chunks.push(c));
    steelRes.on("end", () => {
      const body = rewriteBody(Buffer.concat(chunks).toString("utf8"));
      outHeaders["content-length"] = String(Buffer.byteLength(body));
      outHeaders["cache-control"] = "no-store";
      res.writeHead(steelRes.statusCode || 502, outHeaders);
      res.end(body);
    });
  });
  out.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("browser unreachable");
  });
  req.pipe(out);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;

  if (path === BASE_PATH) {
    res.writeHead(302, { location: `${BASE_PATH}/` });
    res.end();
    return;
  }

  if (path === `${BASE_PATH}/api/health`) {
    const target = new URL("/json/version", CDP_BASE_URL);
    const probe = http.request(target, { method: "GET" }, (cdpRes) => {
      const chunks = [];
      cdpRes.on("data", (c) => chunks.push(c));
      cdpRes.on("end", () => {
        let browser = null;
        try {
          browser = JSON.parse(Buffer.concat(chunks).toString("utf8")).Browser || null;
        } catch {
          browser = null;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", basePath: BASE_PATH, browserUp: true, browser }));
      });
    });
    probe.on("error", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", basePath: BASE_PATH, browserUp: false }));
    });
    probe.end();
    return;
  }

  if (routeFor(path)) {
    proxyHttp(req, res);
    return;
  }

  if (path === `${BASE_PATH}/view`) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(view);
    return;
  }

  if (path === `${BASE_PATH}/` || path.startsWith(`${BASE_PATH}/`)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.on("upgrade", (req, socket) => {
  console.log(`upgrade-in ${req.method} ${req.url}`);
  const url = new URL(req.url || "/", "http://localhost");
  if (!routeFor(url.pathname)) {
    console.log(`upgrade-reject ${url.pathname}`);
    socket.destroy();
    return;
  }
  (async () => {
    const route = routeFor(url.pathname);
    if (!route) {
      socket.destroy();
      return;
    }
    const rest = stripPath(url.pathname, route.prefix);
    const target = new URL(rest + url.search, route.base);
    console.log(`upgrade ${url.pathname} -> ${rest}`);
    // Chromium's DevTools server rejects browser origins it does not allowlist
    // (403). The proxy is already behind the OAuth gate, so drop Origin and let
    // the handshake through as a non-browser client.
    const { origin: _droppedOrigin, ...fwdHeaders } = req.headers;
    const out = http.request(target, {
      method: req.method,
      headers: { ...fwdHeaders, host: target.host },
    });
    out.on("upgrade", (steelRes, steelSocket) => {
      socket.write("HTTP/1.1 101 Switching Protocols\r\n");
      for (const [k, v] of Object.entries(steelRes.headers)) {
        if (v !== undefined) socket.write(`${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`);
      }
      socket.write("\r\n");
      steelSocket.pipe(socket);
      socket.pipe(steelSocket);
    });
    out.on("response", (steelRes) => {
      console.error(`steel answered upgrade with ${steelRes.statusCode} for ${rest}`);
      socket.write(`HTTP/1.1 ${steelRes.statusCode} ${steelRes.statusMessage || ""}\r\n`);
      for (const [k, v] of Object.entries(steelRes.headers)) {
        if (v !== undefined) socket.write(`${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`);
      }
      socket.write("\r\n");
      steelRes.pipe(socket);
    });
    out.on("error", (err) => {
      console.error(`upgrade to ${rest} failed: ${err.message}`);
      socket.destroy();
    });
    out.end();
  })().catch(() => socket.destroy());
});

server.on("clientError", (err, socket) => {
  console.log(`client-error ${err.message}`);
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`cobrowse preview on http://${HOST}:${PORT}${BASE_PATH}/`);
});
