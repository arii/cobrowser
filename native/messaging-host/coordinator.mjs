import net from 'node:net';
import { mkdir, chmod, lstat, readFile, writeFile, unlink } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { decoder, frame, validPing } from './protocol.mjs';

export async function startCoordinator(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('runtime-directory-must-be-user-only');
  const socketPath = join(dir, 'relay.sock');
  // Never unlink another running coordinator's socket. Caller removes stale sockets explicitly.
  let token;
  try { token = await readFile(join(dir, 'token'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; token = randomBytes(32).toString('hex'); await writeFile(join(dir, 'token'), token, { mode: 0o600, flag: 'wx' }); }
  const clients = new Set(); const seen = new Map();
  const server = net.createServer(socket => {
    clients.add(socket); socket.on('close', () => clients.delete(socket));
    socket.setTimeout(30_000, () => socket.destroy()); socket.on('error', () => {});
    socket.on('data', decoder(envelope => {
      const supplied = typeof envelope?.token === 'string' ? Buffer.from(envelope.token) : Buffer.alloc(0);
      const secret = Buffer.from(token);
      if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret) || !validPing(envelope.message)) { socket.destroy(); return; }
      const m = envelope.message; const key = `${m.client}:${m.seq}`;
      const duplicate = seen.has(key);
      if (!duplicate) { seen.set(key, true); if (seen.size > 1024) seen.delete(seen.keys().next().value); }
      socket.write(frame({ v: 1, kind: 'ack', client: m.client, seq: m.seq, duplicate, coordinator: 'phase0-local-process' }));
    }, () => socket.destroy()));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  return { socketPath, close: async () => { for (const c of clients) c.destroy(); await new Promise(resolve => server.close(resolve)); await unlink(socketPath).catch(() => {}); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.HARNESS_RUNTIME_DIR;
  if (!dir) throw new Error('Set HARNESS_RUNTIME_DIR to an absolute private directory');
  const relay = await startCoordinator(dir);
  console.log(JSON.stringify({ kind: 'ready', socket: relay.socketPath }));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, async () => { await relay.close(); process.exit(0); });
}
