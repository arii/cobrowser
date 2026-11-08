// Reads dailySkills/.env (gitignored) without a dependency. Shell variables win over the file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function loadEnv(): NodeJS.ProcessEnv {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return process.env; }
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith('#') && process.env[match[1]] === undefined && match[2] !== '') process.env[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return process.env;
}
