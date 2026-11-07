import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

// Public synthetic fixture. Mutation is supervisor construction-time configuration,
// never a page-accessible reset/admin endpoint.
export async function startFixture(wrongWeek = false, port = 0) {
  const audit: { team: string; start: string; end: string }[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    if (url.pathname === '/export') {
      let start = url.searchParams.get('start') ?? '';
      let end = url.searchParams.get('end') ?? '';
      const team = url.searchParams.get('team') ?? '';
      if (!['red', 'blue'].includes(team) || !/^2026-\d\d-\d\d$/.test(start) || !/^2026-\d\d-\d\d$/.test(end)) {
        res.writeHead(400).end(); return;
      }
      if (wrongWeek) {
        start = new Date(Date.parse(start) + 7 * 86400000).toISOString().slice(0, 10);
        end = new Date(Date.parse(end) + 7 * 86400000).toISOString().slice(0, 10);
      }
      audit.push({ team, start, end });
      const rows = ['team,date,value'];
      // Export implementation deliberately owns its own synthetic dataset.
      for (let day = 19; day <= 49; day++) {
        const d = new Date(Date.UTC(2026, 9, day));
        const date = d.toISOString().slice(0, 10);
        if (date >= start && date < end) rows.push(`${team},${date},${(team === 'red' ? 100 : 200) + d.getUTCDate()}`);
      }
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="report.csv"' });
      res.end(rows.join('\n') + '\n'); return;
    }
    if (url.pathname !== '/') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html><head><title>Harness fixture phase0-agent-7f3a91</title>
      <style>body{font:18px system-ui;margin:32px}input,button,select{font:inherit;margin:8px}#probe{position:absolute;left:32px;top:400px;width:300px;height:40px;box-sizing:border-box}</style></head>
      <body><h1>Reporting fixture</h1><form action="/export">
      <label>Team <select name="team"><option>red</option><option>blue</option></select></label><br>
      <label>Start inclusive <input name="start" value="2026-10-26"></label><br>
      <label>End exclusive <input name="end" value="2026-11-02"></label><br>
      <button id="export">Export CSV</button></form><p id="status"></p>
      <input id="probe" aria-label="CDP typing probe" placeholder="CDP typing probe">
      <script>document.querySelector('form').addEventListener('submit',()=>document.querySelector('#status').textContent='Export successful');</script>
      </body></html>`);
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${address.port}`, audit, close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixture(process.argv.includes('--wrong-week'), 3210);
  console.log(JSON.stringify({ origin: fixture.origin, mutation: process.argv.includes('--wrong-week') ? 'wrong-week-demo' : 'none' }));
}
