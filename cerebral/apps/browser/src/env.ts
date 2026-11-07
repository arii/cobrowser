// Loads the repo's .env before any other module reads process.env. Imported first by server.ts:
// ES module evaluation follows import order, so this runs before session.ts computes its settings.
// Real environment variables still win over .env values.
import path from "node:path";

try {
  const repoEnv = path.resolve(import.meta.dirname, "../../../.env");
  const before = { ...process.env };
  process.loadEnvFile(repoEnv);
  for (const k of Object.keys(before)) process.env[k] = before[k];
} catch {
  /* no .env: defaults apply */
}
