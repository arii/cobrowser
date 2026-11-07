// Minimal /cobrowse preview server (Tier 1 shape).
// Implements the repo-previews app contract: everything under BASE_PATH,
// no root-absolute URLs, bare-path redirect, JSON health endpoint.
// Zero dependencies: plain Node http.

import http from "node:http";

const BASE_PATH = process.env.BASE_PATH || "/cobrowse";
const PORT = Number(process.env.PORT || "3101");
const HOST = process.env.HOST || "0.0.0.0";

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
<p id="status">Viewer not connected.</p>
<script>
fetch("${BASE_PATH}/api/health").then(function (r) { return r.json(); }).then(function (j) {
  document.getElementById("status").textContent = "Backend: " + j.status;
}).catch(function () {
  document.getElementById("status").textContent = "Backend unreachable.";
});
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;

  if (path === BASE_PATH) {
    res.writeHead(302, { location: `${BASE_PATH}/` });
    res.end();
    return;
  }

  if (path === `${BASE_PATH}/api/health`) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", basePath: BASE_PATH }));
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

server.listen(PORT, HOST, () => {
  console.log(`cobrowse preview on http://${HOST}:${PORT}${BASE_PATH}/`);
});
