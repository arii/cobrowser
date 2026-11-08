// Reads KEY=VALUE lines from this folder's .env without overriding variables already exported in the shell.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Loads dailySkills/.env first, then the repository root .env as a fallback for the same variable names. */
export function loadEnv(files = [join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env')]): void {
  for (const file of files) loadOne(file);
}
function loadOne(file: string): void {
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('='); if (eq < 1) continue;
    const key = line.slice(0, eq).trim(), value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (/^[A-Z_][A-Z0-9_]*$/.test(key) && process.env[key] === undefined && value !== '') process.env[key] = value;
  }
}
