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
const STEEL_BASE_URL = process.env.STEEL_BASE_URL || "http://172.18.0.1:3000";
const LIVE_PREFIX = `${BASE_PATH}/live`;
const CDP_PREFIX = `${BASE_PATH}/cdp`;
const CDP_BASE_URL = process.env.CDP_BASE_URL || "http://127.0.0.1:9223";
const AGENT_PREFIX = `${BASE_PATH}/agent`;
const AGENT_BASE_URL = process.env.AGENT_BASE_URL || "http://127.0.0.1:8000";

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
<p><a href="${LIVE_PREFIX}/ui">Open the Steel live viewer</a></p>
<p><a href="${BASE_PATH}/live-view">Open the CDP live view</a> (works even when Steel shows offline)</p>
<iframe src="${LIVE_PREFIX}/ui" width="1280" height="800" title="Live browser"></iframe>
<p id="status">Backend: checking…</p>
<script>
fetch("${BASE_PATH}/api/health").then(function (r) { return r.json(); }).then(function (j) {
  document.getElementById("status").textContent = "Backend: " + j.status +
    ", steel: " + (j.steelUp ? "up" : "down");
}).catch(function () {
  document.getElementById("status").textContent = "Backend unreachable.";
});
</script>
</body>
</html>`;

function steelPath(urlPath) {
  const rest = urlPath.slice(LIVE_PREFIX.length) || "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

const viewPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CDP live view</title>
<style>
  body { font-family: sans-serif; margin: 12px; background: #111; color: #eee; }
  a { color: #7db3ff; }
  #bar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  #status { font-family: monospace; font-size: 13px; }
  #wrap { position: relative; display: inline-block; max-width: 100%; }
  #screen { display: block; max-width: 100%; border: 1px solid #444; cursor: crosshair; }
  #cursor { position: absolute; width: 18px; height: 18px; border-radius: 50%;
    background: rgba(255,59,48,0.85); border: 2px solid #fff; pointer-events: none;
    transform: translate(-50%,-50%); display: none; }
  .online { color: #4ade80; } .offline { color: #f87171; }
</style>
</head>
<body>
<div id="bar">
  <a id="back" href="./">back</a>
  <select id="targets" title="Page target"></select>
  <button id="refresh">refresh targets</button>
  <button id="reconnect">reconnect</button>
  <span id="status" class="offline">starting…</span>
</div>
<div id="wrap"><canvas id="screen"></canvas><div id="cursor"></div></div>
<script>
(function () {
  var statusEl = document.getElementById("status");
  var targetsEl = document.getElementById("targets");
  var canvas = document.getElementById("screen");
  var ctx = canvas.getContext("2d");
  var cursor = document.getElementById("cursor");
  var ws = null, seq = 0, pending = {}, shotInFlight = false;
  var frames = 0, fpsAt = Date.now(), vw = 0, vh = 0, currentId = null;

  function setStatus(txt, online) {
    statusEl.textContent = txt;
    statusEl.className = online ? "online" : "offline";
  }
  function wsUrl(id) {
    var u = new URL("cdp/devtools/page/" + id, window.location.href);
    if (u.protocol === "http:") u.protocol = "ws:";
    if (u.protocol === "https:") u.protocol = "wss:";
    return u.toString();
  }
  function send(method, params) {
    return new Promise(function (resolve, reject) {
      if (!ws || ws.readyState !== 1) return reject(new Error("socket not open"));
      seq += 1;
      pending[seq] = { resolve: resolve, reject: reject };
      ws.send(JSON.stringify({ id: seq, method: method, params: params || {} }));
      setTimeout(function () {
        if (pending[seq]) { delete pending[seq]; reject(new Error("cdp timeout")); }
      }, 8000);
    });
  }
  function shoot() {
    if (shotInFlight || !ws || ws.readyState !== 1) return;
    shotInFlight = true;
    send("Page.captureScreenshot", { format: "jpeg", quality: 60 }).then(function (r) {
      shotInFlight = false;
      var img = new Image();
      img.onload = function () {
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          vw = img.naturalWidth; vh = img.naturalHeight;
        }
        ctx.drawImage(img, 0, 0);
        frames += 1;
        var now = Date.now();
        if (now - fpsAt > 2000) {
          var fps = Math.round(frames * 1000 / (now - fpsAt));
          setStatus("LIVE " + (currentId || "").slice(0, 8) + " " + vw + "x" + vh + " " + fps + "fps", true);
          frames = 0; fpsAt = now;
        }
        shoot();
      };
      img.onerror = function () { shotInFlight = false; setTimeout(shoot, 500); };
      img.src = "data:image/jpeg;base64," + r.data;
    }).catch(function (e) {
      shotInFlight = false;
      setStatus("OFFLINE: " + e.message + " — reconnecting…", false);
      setTimeout(connect, 1500);
    });
  }
  function toPage(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * vw / Math.max(1, r.width)),
      y: Math.round((e.clientY - r.top) * vh / Math.max(1, r.height))
    };
  }
  canvas.addEventListener("mousemove", function (e) {
    var r = canvas.getBoundingClientRect();
    cursor.style.display = "block";
    cursor.style.left = (e.clientX - r.left) + "px";
    cursor.style.top = (e.clientY - r.top) + "px";
    var p = toPage(e);
    send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }).catch(function () {});
  });
  canvas.addEventListener("mouseleave", function () { cursor.style.display = "none"; });
  canvas.addEventListener("click", function (e) {
    var p = toPage(e);
    cursor.style.transform = "translate(-50%,-50%) scale(0.65)";
    setTimeout(function () { cursor.style.transform = "translate(-50%,-50%) scale(1)"; }, 120);
    send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 })
      .then(function () {
        return send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
      }).then(shoot).catch(function () {});
  });
  document.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "SELECT" || e.target.tagName === "INPUT")) return;
    var p = { x: 0, y: 0 };
    var sendKey = function (type) {
      return send("Input.dispatchKeyEvent", {
        type: type, text: e.key.length === 1 ? e.key : undefined,
        unmodifiedText: e.key.length === 1 ? e.key : undefined,
        key: e.key, code: e.code || "Key" + (e.key || "").toUpperCase(),
        windowsVirtualKeyCode: e.keyCode
      });
    };
    e.preventDefault();
    sendKey("keyDown").then(function () { return sendKey("keyUp"); }).then(shoot).catch(function () {});
  });
  function connect() {
    var id = targetsEl.value || currentId;
    if (!id) { setStatus("OFFLINE: no page target — refresh targets", false); return; }
    currentId = id;
    if (ws) { try { ws.close(); } catch (e) {} }
    setStatus("connecting " + id.slice(0, 8) + "…", false);
    ws = new WebSocket(wsUrl(id));
    ws.onopen = function () { shoot(); };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending[m.id]) {
        var p = pending[m.id];
        delete pending[m.id];
        if (m.error) p.reject(new Error(m.error.message || "cdp error"));
        else p.resolve(m.result || {});
      }
    };
    ws.onclose = function () {
      setStatus("OFFLINE: socket closed — reconnecting…", false);
      setTimeout(connect, 1500);
    };
    ws.onerror = function () {
      try { ws.close(); } catch (e) {}
    };
  }
  function loadTargets() {
    fetch("cdp/json/list").then(function (r) {
      if (!r.ok) throw new Error("list HTTP " + r.status);
      return r.json();
    }).then(function (list) {
      var pages = list.filter(function (t) { return t.type === "page"; });
      targetsEl.innerHTML = "";
      pages.forEach(function (t) {
        var o = document.createElement("option");
        o.value = t.id;
        o.textContent = t.id.slice(0, 8) + " " + (t.url || "").slice(0, 60);
        targetsEl.appendChild(o);
      });
      if (!pages.length) { setStatus("OFFLINE: no page targets", false); return; }
      if (!currentId || !pages.some(function (t) { return t.id === currentId; })) {
        currentId = pages[0].id;
        targetsEl.value = currentId;
      }
      connect();
    }).catch(function (e) {
      setStatus("OFFLINE: " + e.message, false);
    });
  }
  document.getElementById("refresh").addEventListener("click", loadTargets);
  document.getElementById("reconnect").addEventListener("click", connect);
  targetsEl.addEventListener("change", function () { currentId = targetsEl.value; connect(); });
  loadTargets();
})();
</script>
</body>
</html>`;

const PUBLIC_LIVE = process.env.PUBLIC_LIVE || "https://dev-onasafari.ddns.net:8443/cobrowse/live";
const PUBLIC_LIVE_WS = PUBLIC_LIVE.replace(/^http/, "ws");

const REWRITES = [
  ["ws://localhost:3000", PUBLIC_LIVE_WS],
  ["http://localhost:3000", PUBLIC_LIVE],
  ["`/v1/", "`/cobrowse/live/v1/"],
  ['"/v1/', '"/cobrowse/live/v1/'],
  ["'/v1/", "'/cobrowse/live/v1/"],
  ["`/ui`", "`/cobrowse/live/ui`"],
  ["`/ui/", "`/cobrowse/live/ui/"],
  ['"/ui', '"/cobrowse/live/ui'],
  ["'/ui", "'/cobrowse/live/ui"],
  ["url(/ui", "url(/cobrowse/live/ui"],
];

function rewriteBody(text) {
  let out = text;
  for (const [from, to] of REWRITES) out = out.split(from).join(to);
  return out;
}

function steelJson(path, method, body) {
  return new Promise((resolve) => {
    const target = new URL(path, STEEL_BASE_URL);
    const payload = body === undefined ? null : JSON.stringify(body);
    const out = http.request(
      target,
      {
        method: method || "GET",
        headers: { "content-type": "application/json", host: target.host },
      },
      (steelRes) => {
        const chunks = [];
        steelRes.on("data", (c) => chunks.push(c));
        steelRes.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolve(null);
          }
        });
      },
    );
    out.on("error", () => resolve(null));
    if (payload) out.write(payload);
    out.end();
  });
}

let cachedSession = { id: null, at: 0 };

async function liveSessionId() {
  if (cachedSession.id && Date.now() - cachedSession.at < 10000) return cachedSession.id;
  const data = await steelJson("/v1/sessions");
  const list = data?.sessions ?? [];
  let current = list.find((s) => s?.status === "live");
  if (!current) {
    await steelJson("/v1/sessions", "POST", {});
    const fresh = await steelJson("/v1/sessions");
    const freshList = fresh?.sessions ?? [];
    current = freshList.find((s) => s?.status === "live") || list[0] || null;
  }
  cachedSession = { id: current ? current.id : null, at: Date.now() };
  return cachedSession.id;
}

// Steel's tab-discovery client calls /v1/sessions/cast with no id; Steel only
// answers /v1/sessions/<id>/cast. Route id-less discovery at the newest session.
async function withSessionId(steelRest) {
  if (steelRest !== "/v1/sessions/cast") return steelRest;
  const id = await liveSessionId().catch(() => null);
  if (id) console.log(`cast discovery -> session ${id}`);
  return id ? `/v1/sessions/${id}/cast` : steelRest;
}

async function proxyHttp(req, res) {
  let steelRest = steelPath(new URL(req.url || "/", "http://localhost").pathname);
  try {
    steelRest = await withSessionId(steelRest);
  } catch (err) {
    console.error(`session lookup failed: ${err}`);
  }
  const target = new URL(steelRest, STEEL_BASE_URL);
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
    res.end("steel unreachable");
  });
  req.pipe(out);
}

function prefixRest(urlPath, prefix) {
  const rest = urlPath.slice(prefix.length) || "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

function proxyPass(req, res, prefix, base) {
  const url = new URL(req.url || "/", "http://localhost");
  const target = new URL(prefixRest(url.pathname, prefix) + url.search, base);
  const { "content-length": _dropped, ...rest } = req.headers;
  const headers = { ...rest, host: target.host, "accept-encoding": "identity" };
  const out = http.request(target, { method: req.method, headers }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  out.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream unreachable");
  });
  req.pipe(out);
}

function proxyUpgrade(req, socket, prefix, base) {
  const url = new URL(req.url || "/", "http://localhost");
  const target = new URL(prefixRest(url.pathname, prefix) + url.search, base);
  const out = http.request(target, {
    method: req.method,
    headers: { ...req.headers, host: target.host },
  });
  out.on("upgrade", (upRes, upSocket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\n");
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (v !== undefined) socket.write(`${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`);
    }
    socket.write("\r\n");
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  out.on("response", (upRes) => {
    socket.write(`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage || ""}\r\n`);
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (v !== undefined) socket.write(`${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`);
    }
    socket.write("\r\n");
    upRes.pipe(socket);
  });
  out.on("error", () => {
    socket.destroy();
  });
  out.end();
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
    const target = new URL("/ui", STEEL_BASE_URL);
    const probe = http.request(target, { method: "HEAD" }, (steelRes) => {
      const up = (steelRes.statusCode || 500) < 500;
      steelRes.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", basePath: BASE_PATH, steelUp: up }));
    });
    probe.on("error", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", basePath: BASE_PATH, steelUp: false }));
    });
    probe.end();
    return;
  }

  if (path === LIVE_PREFIX || path.startsWith(`${LIVE_PREFIX}/`)) {
    proxyHttp(req, res);
    return;
  }

  if (path === CDP_PREFIX || path.startsWith(`${CDP_PREFIX}/`)) {
    proxyPass(req, res, CDP_PREFIX, CDP_BASE_URL);
    return;
  }

  if (path === AGENT_PREFIX || path.startsWith(`${AGENT_PREFIX}/`)) {
    proxyPass(req, res, AGENT_PREFIX, AGENT_BASE_URL);
    return;
  }

  if (path === `${BASE_PATH}/live-view`) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(viewPage);
    return;
  }

  if (path === `${BASE_PATH}/` || path.startsWith(`${BASE_PATH}/`)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === CDP_PREFIX || url.pathname.startsWith(`${CDP_PREFIX}/`)) {
    proxyUpgrade(req, socket, CDP_PREFIX, CDP_BASE_URL);
    return;
  }
  if (url.pathname === AGENT_PREFIX || url.pathname.startsWith(`${AGENT_PREFIX}/`)) {
    proxyUpgrade(req, socket, AGENT_PREFIX, AGENT_BASE_URL);
    return;
  }
  if (!url.pathname.startsWith(LIVE_PREFIX)) {
    socket.destroy();
    return;
  }
  (async () => {
    let rest = steelPath(url.pathname);
    try {
      rest = await withSessionId(rest);
    } catch (err) {
      console.error(`session lookup failed: ${err}`);
    }
    const target = new URL(rest + url.search, STEEL_BASE_URL);
    console.log(`upgrade ${url.pathname} -> ${rest}`);
    const out = http.request(target, {
      method: req.method,
      headers: { ...req.headers, host: target.host },
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

server.listen(PORT, HOST, () => {
  console.log(`cobrowse preview on http://${HOST}:${PORT}${BASE_PATH}/`);
});
