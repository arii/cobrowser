import { build } from 'esbuild';
import { build as buildVite } from 'vite';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
await rm('dist',{recursive:true,force:true});
await mkdir('dist/companion/node_modules',{recursive:true});
const sqlitePackage = require.resolve('better-sqlite3/package.json');
await cp(dirname(sqlitePackage),'dist/companion/node_modules/better-sqlite3',{recursive:true,dereference:true});
const sqliteRequire = createRequire(sqlitePackage);
await cp(dirname(sqliteRequire.resolve('node-addon-api/package.json')),'dist/companion/node_modules/node-addon-api',{recursive:true,dereference:true});
const sqliteVersion = JSON.parse(await readFile(sqlitePackage,'utf8')).version;
await writeFile('dist/companion/package.json',JSON.stringify({name:'harness-companion-runtime',private:true,version:'0.1.0',main:'main.cjs',dependencies:{'better-sqlite3':sqliteVersion}},null,2));
for (const [source,outfile,format] of [
  ['apps/companion/src/main.ts','dist/companion/main.cjs','cjs'],
  ['apps/companion/src/preload.ts','dist/companion/preload.cjs','cjs'],
  ['services/learner/index.ts','dist/workers/learner.mjs','esm'],
  ['services/verifier/index.ts','dist/workers/verifier.mjs','esm'],
  ['services/registry/index.ts','dist/workers/registry.mjs','esm'],
  ['packages/contracts/src/index.ts','dist/packages/contracts.mjs','esm'],
  ['packages/storage/src/index.ts','dist/packages/storage.mjs','esm'],
  ['packages/browser-adapters/src/index.ts','dist/packages/browser-adapters.mjs','esm'],
  ['packages/model-adapters/interfaces.ts','dist/packages/model-adapters.mjs','esm'],
] as const) await build({entryPoints:[source],outfile,format,bundle:true,platform:'node',target:'node24',external:['electron','better-sqlite3'],sourcemap:false});
await build({entryPoints:['packages/contracts/src/schemas.ts','packages/browser-adapters/src/index.ts'],outdir:'dist/browser',bundle:true,format:'esm',platform:'browser',target:'chrome125',entryNames:'[dir]/[name]'});
await buildVite({configFile:resolve('apps/companion/vite.config.ts')});
execFileSync('pnpm',['--filter','@harness/extension','build'],{stdio:'inherit'});
console.log('Built companion, Chrome MV3 extension, packages and local workers. Extension execution requires native-host approval; only synthetic reporting is supported.');
