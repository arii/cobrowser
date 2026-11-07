// stdout is reserved exclusively for Chrome native messaging frames.
import net from 'node:net';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { decoder, frame, validPing } from './protocol.mjs';
const dir = process.env.HARNESS_RUNTIME_DIR;
const send = m => process.stdout.write(frame(m));
let socket;
try {
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error();
  const token = readFileSync(join(dir, 'token'), 'utf8');
  socket = net.createConnection(join(dir, 'relay.sock'));
  socket.on('error', () => process.exit(2));
  socket.on('close', () => process.exit(2));
  socket.on('data', decoder(send, () => process.exit(3)));
  process.stdin.on('data', decoder(message => {
    if (!validPing(message)) { process.exit(3); return; }
    socket.write(frame({ token, message }));
  }, () => process.exit(3)));
  process.stdin.on('end', () => { socket.end(); process.exit(0); });
} catch { process.exit(2); }
