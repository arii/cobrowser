import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
const id = process.argv[2];
if (!id || !/^[a-p]{32}$/.test(id)) throw new Error('Usage: pnpm exec tsx scripts/install-host.ts EXTENSION_ID [Chrome|Chromium|ChromeForTesting]');
const browser = process.argv[3] ?? 'Chrome';
if (!['Chrome','Chromium','ChromeForTesting'].includes(browser)) throw new Error('Unsupported browser');
const root = join(homedir(), 'Library/Application Support/VisualHarnessPhase0'); await mkdir(root, { recursive: true, mode: 0o700 });
const runtime = join(root, 'relay'); await mkdir(runtime, { recursive: true, mode: 0o700 });
// Install self-contained host modules, as a packaged companion would. Do not run
// the Chrome child process against a development tree in a protected folder.
await copyFile(resolve('native/messaging-host/host.mjs'), join(root, 'host.mjs'));
await copyFile(resolve('native/messaging-host/protocol.mjs'), join(root, 'protocol.mjs'));
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const launcher = join(root, 'host');
await writeFile(launcher, `#!/bin/sh\nexport HARNESS_RUNTIME_DIR=${quote(runtime)}\nexec ${quote(process.execPath)} ${quote(join(root, 'host.mjs'))}\n`, { mode: 0o700 });
const base = browser === 'Chromium' ? 'Chromium' : `Google/${browser}`;
const manifests = join(homedir(), 'Library/Application Support', base, 'NativeMessagingHosts');
await mkdir(manifests, { recursive: true });
const manifest = join(manifests, 'com.visual_harness.phase0.json');
await writeFile(manifest, JSON.stringify({ name: 'com.visual_harness.phase0', description: 'Phase 0 local relay', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ manifest, runtime, uninstall: `Remove ${manifest} and ${root}` }));
