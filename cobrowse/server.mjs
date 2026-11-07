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
  let current = list.find((s) => s?.status === "live") || list[0];
  if (!current) {
    const created = await steelJson("/v1/sessions", "POST", {});
    current = created?.id ? created : null;
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
