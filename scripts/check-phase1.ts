import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const directory='docs/decisions/evidence/phase1';
await mkdir(directory,{recursive:true});
const commands: { command: string; exitCode: number | null; durationMs: number; log: string }[]=[];
const steps=[
  ['pnpm',['install','--frozen-lockfile']],['pnpm',['lint']],['pnpm',['typecheck']],['pnpm',['test']],
  ['pnpm',['build']],['pnpm',['rebuild:electron']],['pnpm',['smoke:companion']],
  ['pnpm',['verify:foundation']],['pnpm',['test:integration']],
  ['node',['dist/workers/learner.mjs']],['node',['dist/workers/verifier.mjs']],['node',['dist/workers/registry.mjs']],
] as const;
for (const [executable,args] of steps) {
  const command=`${executable} ${args.join(' ')}`;
  console.log(`Checking ${command}`);
  const started=performance.now();
  const child=spawn(executable,[...args],{stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  const timeout=setTimeout(()=>child.kill('SIGTERM'),180000);
  const exitCode=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  clearTimeout(timeout);
  const filename=`${String(commands.length+1).padStart(2,'0')}-${args[0].replaceAll(':','-').replaceAll('/','-')}.log`;
  await writeFile(join(directory,filename),log);
  commands.push({command,exitCode,durationMs:Math.round(performance.now()-started),log:filename});
  await writeFile(join(directory,'commands.json'),JSON.stringify({schemaVersion:1,completedUTC:new Date().toISOString(),node:process.version,commands},null,2)+'\n');
  if (exitCode!==0) { console.error(log);throw new Error(`Phase 1 check failed: ${command}`); }
}
await copyFile('.local/evidence/foundation.json',join(directory,'foundation.json'));
await copyFile('.local/evidence/popup-ui.json',join(directory,'built-popup.json'));
const paths=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','eslint.config.mjs','plan.md'];
async function scan(dir: string) {
  for (const file of await readdir(dir,{withFileTypes:true})) {
    if (file.name.startsWith('.') || file.name==='node_modules') continue;
    const path=join(dir,file.name);
    if (file.isDirectory()) await scan(path);else if (/\.(ts|tsx|js|mjs|json|html|css|swift)$/.test(path)) paths.push(path);
  }
}
for (const dir of ['apps','packages','services','scripts','tests']) await scan(dir);
const sha256=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const sourceHashes=Object.fromEntries(await Promise.all(paths.sort().map(async path=>[path,await sha256(path)])));
const files=(await readdir(directory)).filter(name=>name!=='hashes.json');
const evidenceHashes=Object.fromEntries(await Promise.all(files.sort().map(async name=>[name,await sha256(join(directory,name))])));
await writeFile(join(directory,'hashes.json'),JSON.stringify({schemaVersion:1,sourceHashes,evidenceHashes},null,2)+'\n');
console.log(`Phase 1 checks passed; actual command results and hashes recorded in ${directory}. Keychain/live-model checks are excluded and remain unverified.`);
