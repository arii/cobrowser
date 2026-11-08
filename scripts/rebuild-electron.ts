import { rebuild } from '@electron/rebuild';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const version = JSON.parse(await readFile(require.resolve('electron/package.json'),'utf8')).version as string;
// Rebuild a staged copy only. Never overwrite the native binding used by Node tests.
await readFile('dist/companion/package.json');
await rm('dist/companion/node_modules/better-sqlite3/prebuilds',{recursive:true,force:true});
await rebuild({buildPath:resolve('dist/companion'),electronVersion:version,arch:process.arch,onlyModules:['better-sqlite3'],force:true});
console.log(JSON.stringify({electron:version,module:'better-sqlite3',sourceRebuild:'completed',location:'dist/companion/node_modules/better-sqlite3',nodeTestBinding:'untouched'}));
