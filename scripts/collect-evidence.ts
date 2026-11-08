import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
// Deliberate allowlist. Never copy generic logs, env files or arbitrary screenshots.
const artifacts = ['browser-headless.json','browser-headed.json','native.json','native-initial-failure.json',
  'verifier.json','models-replay.json','models-live.json','unit-tests.log','typecheck.log','swift-build.log'];
const target = 'docs/decisions/evidence';
await mkdir(target,{recursive:true});
for (const file of artifacts) await copyFile(join('.local/evidence',file),join(target,file));
const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
const evidenceHashes = Object.fromEntries(await Promise.all(artifacts.map(async file=>[file,await digest(join(target,file))])));
const sources: string[] = ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','.node-version','plan.md'];
async function scan(dir: string) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    if (entry.name.startsWith('.')) continue;
    const path=join(dir,entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(ts|mjs|js|json|swift|html)$/.test(path)) sources.push(path);
  }
}
for (const dir of ['apps','native','packages','services','scripts','tests']) await scan(dir);
const sourceHashes = Object.fromEntries(await Promise.all(sources.sort().map(async file=>[file,await digest(file)])));
const command = (name:string,args:string[]) => execFileSync(name,args,{encoding:'utf8'}).trim();
const manifest = {
  collectedUTC:new Date().toISOString(), mode:'curated-actual-run-evidence', sourceRevision:'uncommitted initial repository',
  versions:{node:process.version,pnpm:command('pnpm',['--version']),macOS:command('sw_vers',['-productVersion']),macOSBuild:command('sw_vers',['-buildVersion']),swift:command('swift',['--version']),
    installedChrome:command('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString','/Applications/Google Chrome.app/Contents/Info.plist']),playwright:'1.65.0',browserUnderTest:'158.0.8127.18',architecture:process.arch,docker:'not installed'},
  note:'Collection does not execute probes or assert success. See individual artifacts and decisions for measured outcomes and blockers.',
  reproductionCommands:[
    'pnpm install --frozen-lockfile', 'pnpm exec playwright install chromium',
    'pnpm typecheck', 'pnpm test', 'pnpm build:native', 'pnpm verify:fixtures',
    'pnpm probe:browser', 'pnpm probe:browser --headed --native', 'pnpm probe:models',
    'HARNESS_CLOUD_ENABLED=1 pnpm probe:models --live',
  ],
  evidenceHashes,sourceHashes,
};
await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Curated synthetic evidence and source hashes recorded; probe outcomes remain in their individual reports.');
