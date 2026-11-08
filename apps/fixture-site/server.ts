import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { fixturePage } from './page.js';
import { dispatchPage } from './dispatch.js';

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
    if (url.pathname === '/dispatch') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(dispatchPage); return;
    }
    if (url.pathname !== '/') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(fixturePage);
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${address.port}`, audit, close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startFixture(process.argv.includes('--wrong-week'), 3210).then(fixture => {
    console.log(JSON.stringify({ origin: fixture.origin, mutation: process.argv.includes('--wrong-week') ? 'wrong-week-demo' : 'none' }));
  });
}
