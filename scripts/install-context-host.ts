import { mkdir, writeFile, chmod, lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { buildContextHost } from './context-host-runtime.js';
import { parseEnv } from 'node:util';
import { liveContextProviders } from '../packages/model-adapters/context.js';
const id='afchllcepipgheklaapddihncbpmfocl';
const root=process.platform==='darwin'?join(homedir(),'Library/Application Support/Cobrowser/context-host'):join(homedir(),'.local/share/cobrowser/context-host');
await mkdir(root,{recursive:true,mode:0o700});
const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077))throw new Error('context-host-directory-must-be-private');
await buildContextHost(root);
const module=join(root,'host.cjs');
if(process.argv.includes('--runtime-only')){console.log(JSON.stringify({updated:true,runtime:root,credentials:'unchanged'}));process.exit(0);}
const quote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
const settings=parseEnv(await readFile(resolve('.env'),'utf8'));
liveContextProviders({...process.env,...settings});
const envPath=join(root,'config.env');
const names=['HARNESS_CLOUD_ENABLED','SUBQ_API_KEY','LLAMA_SCHEMA','LLAMA_ENDPOINT','LLAMA_MODEL','LLAMA_API_KEY','CONTEXT_PROVIDER'];
await writeFile(envPath,names.filter(name=>settings[name]!==undefined).map(name=>`${name}=${JSON.stringify(settings[name])}`).join('\n')+'\n',{mode:0o600});await chmod(envPath,0o600);
const launcher=join(root,'host');
await writeFile(launcher,`#!/bin/sh\nexec ${quote(process.execPath)} --env-file=${quote(envPath)} ${quote(module)} "$@"\n`,{mode:0o700});await chmod(launcher,0o700);
const dirs=process.platform==='darwin'?[join(homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts')]:[join(homedir(),'.config/google-chrome/NativeMessagingHosts'),join(homedir(),'.config/chromium/NativeMessagingHosts')];
const manifests:string[]=[];
for(const dir of dirs){await mkdir(dir,{recursive:true});const manifest=join(dir,'com.cobrowser.context.json');await writeFile(manifest,JSON.stringify({name:'com.cobrowser.context',description:'Cobrowser local context brain',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]},null,2),{mode:0o600});manifests.push(manifest);}
console.log(JSON.stringify({installed:true,manifests,runtime:root,keyStorage:'private local host config; never copied to extension'}));
