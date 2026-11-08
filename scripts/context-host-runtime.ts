import { build } from 'esbuild';
import { cp, chmod, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Keep native/Playwright packages external so their binary/resource paths survive
// bundling. Shared by installation and isolated native-messaging acceptance tests.
export async function buildContextHost(root:string){
  await mkdir(root,{recursive:true,mode:0o700});
  const module=join(root,'host.cjs');
  await build({entryPoints:['scripts/context-brain-host.ts'],outfile:module,bundle:true,format:'cjs',platform:'node',target:'node24',external:['better-sqlite3','playwright']});await chmod(module,0o600);
  const require=createRequire(import.meta.url);
  for(const name of ['better-sqlite3','node-addon-api','playwright','playwright-core']){
    const resolver=name==='node-addon-api'?createRequire(require.resolve('better-sqlite3/package.json')):name==='playwright-core'?createRequire(require.resolve('playwright/package.json')):require;
    await cp(dirname(resolver.resolve(`${name}/package.json`)),join(root,'node_modules',name),{recursive:true,dereference:true});
  }
  return module;
}
