import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';
// @ts-expect-error Native relay is dependency-free Node JavaScript.
import { startCoordinator } from '../native/messaging-host/coordinator.mjs';

const headed = process.argv.includes('--headed');
const native = process.argv.includes('--native');
if (native && !headed) throw new Error('--native requires --headed');
const root = await mkdtemp(join(tmpdir(), 'harness-phase0-'));
await mkdir('.local/evidence', {recursive:true});
const fixture = await startFixture(false, 3210);
const extension = resolve('apps/extension');
const manifest = JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
const id = createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const runtime = join(root,'relay'); await mkdir(runtime,{mode:0o700});
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
await copyFile(resolve('native/messaging-host/host.mjs'),join(root,'host.mjs'));
await copyFile(resolve('native/messaging-host/protocol.mjs'),join(root,'protocol.mjs'));
const launcher = join(root,'host');
await writeFile(launcher, `#!/bin/sh\nexport HARNESS_RUNTIME_DIR=${quote(runtime)}\nexec ${quote(process.execPath)} ${quote(join(root,'host.mjs'))}\n`, {mode:0o700});
let relay: any, context: BrowserContext | undefined;
const results: unknown[] = [];
async function nativeProbe(page: Page) {
  const helper = resolve('native/macos-capture/.build/debug/CaptureProbe');
  const collect = (args: string[]) => new Promise<string>((resolve, reject) => {
    const child = spawn(helper,args); let text=''; child.stdout.on('data', b=>text+=b); child.on('error',reject); child.on('exit',()=>resolve(text));
  });
  const lines = (await collect(['--list'])).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  const windows = lines.filter(m=>m.event==='window' && m.title.includes('phase0-agent-7f3a91'));
  if (windows.length !== 1) return {verdict:'blocked',reason:lines.some(m=>m.reason==='screen-recording-permission')?'screen-recording-permission':'unique-visible-fixture-window-not-found'};
  const child = spawn(helper,['--window',String(windows[0].nativeWindowId),'--marker','phase0-agent-7f3a91']);
  let text='', stderr=''; child.stdout.on('data', b=>text+=b); child.stderr.on('data',b=>stderr+=b);
  const started = Date.now();
  const waitFor = async (predicate:()=>boolean) => {
    while (!predicate()) { if (Date.now()-started>16000) throw new Error('native-frame-timeout'); await new Promise(r=>setTimeout(r,100)); }
  };
  try {
    await waitFor(()=>text.includes('"event":"frame"'));
    child.stdin.write('pause\n'); await waitFor(()=>text.includes('"event":"paused"'));
    const count = (text.match(/"event":"frame"/g)??[]).length;
    await new Promise(r=>setTimeout(r,1200));
    assert.equal((text.match(/"event":"frame"/g)??[]).length,count);
    child.stdin.write('resume\n'); await waitFor(()=>text.includes('"event":"resumed"'));
    await waitFor(()=>(text.match(/"event":"frame"/g)??[]).length>count);
    await page.evaluate(()=>{document.title='Excluded synthetic title';});
    await waitFor(()=>text.includes('identity-or-title-lost'));
    const afterExclusion=(text.match(/"event":"frame"/g)??[]).length;
    await new Promise(r=>setTimeout(r,1200));
    assert.equal((text.match(/"event":"frame"/g)??[]).length,afterExclusion);
    child.stdin.end('quit\n');
    await new Promise<void>(r=>child.once('exit',()=>r()));
    const events = text.trim().split('\n').map(s=>JSON.parse(s));
    await writeFile('.local/evidence/native.json',JSON.stringify({mode:'live-selected-synthetic-window',matching:windows[0],events},null,2));
    return {verdict:'passed',events,matching:windows[0]};
  } catch (e) {
    const result = {verdict:'failed',reason:e instanceof Error?e.message:'native-error',events:text.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)),stderr};
    await writeFile('.local/evidence/native.json',JSON.stringify(result,null,2));
    return result;
  } finally { child.kill(); }
}
try {
  for (const dpr of [1,2]) {
    const hostDir=join(root,`profile-${dpr}`,'NativeMessagingHosts');
    await mkdir(hostDir,{recursive:true});
    await writeFile(join(hostDir,'com.visual_harness.phase0.json'),JSON.stringify({name:'com.visual_harness.phase0',description:'Temporary Phase 0 probe',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]}),{flag:'wx',mode:0o600});
    console.error(`Starting isolated browser DPR ${dpr}`);
    context = await chromium.launchPersistentContext(join(root,`profile-${dpr}`), {channel:'chromium',headless:!headed,viewport:{width:1000,height:700},deviceScaleFactor:dpr,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    assert.equal(worker.url().split('/')[2],id);
    if (dpr === 1) {
      // Real extension -> Chrome-spawned native process -> Unix socket -> coordinator.
      // Initial unavailable process, then recover without replacing the extension.
      const ping = worker.evaluate(()=> (globalThis as any).phase0.ping(1));
      await new Promise(r=>setTimeout(r,500)); relay = await startCoordinator(runtime);
      console.error('Testing absent coordinator recovery');
      const ack = await ping.catch(async()=>{throw new Error('Native connection: '+await worker.evaluate(()=>JSON.stringify({error:(globalThis as any).lastNativeError,ack:(globalThis as any).lastAck})));}); assert.equal(ack.kind,'ack');
      const duplicate = await worker.evaluate(()=> (globalThis as any).phase0.ping(1)); assert.equal(duplicate.duplicate,true);
      await relay.close(); relay=undefined;
      const reconnect = worker.evaluate(()=> (globalThis as any).phase0.ping(2));
      await new Promise(r=>setTimeout(r,500)); relay = await startCoordinator(runtime);
      const recovered = await reconnect; assert.equal(recovered.seq,2);
      results.push({bridge:'live-native-messaging',ack,duplicate,recovered,limitation:'deduplication is bounded in memory and resets on coordinator restart; ping only'});
    }
    console.error('Testing assigned tab screenshots and input');
    const assigned = await worker.evaluate(()=> (globalThis as any).phase0.assign());
    const deadline = Date.now()+10000;
    while (!context.pages().some(p=>p.url()===`${fixture.origin}/`)) {
      if (Date.now()>deadline) throw new Error('assigned-page-not-found');
      await new Promise(r=>setTimeout(r,50));
    }
    const agent = context.pages().find(p=>p.url()===`${fixture.origin}/`)!;
    await agent.waitForLoadState();
    for (const zoom of [1,1.25]) for (const active of [true,false]) {
      await worker.evaluate(async ({tabId,zoom,active})=>{
        await (globalThis as any).chrome.tabs.setZoom(tabId,zoom);
        if (!active) await (globalThis as any).chrome.tabs.create({url:'about:blank',active:true});
        else await (globalThis as any).chrome.tabs.update(tabId,{active:true});
      },{tabId:assigned.tabId,zoom,active});
      const shot = await worker.evaluate(()=> (globalThis as any).phase0.screenshot());
      const png = Buffer.from(shot.png,'base64');
      const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
      const typed = `dpr${dpr}-zoom${zoom}-${active?'foreground':'background'}`;
      // Coordinates in CSS viewport pixels, selected from fixed synthetic screenshot layout.
      await worker.evaluate(async ({id,text})=> (globalThis as any).phase0.clickType({observationId:id,x:65,y:425,text}),{id:shot.observation.id,text:typed});
      const observed = await agent.locator('#probe').inputValue();
      assert.ok(observed.includes(typed),`Input did not reach assigned tab: ${typed}`);
      await assert.rejects(worker.evaluate(async ({id})=> (globalThis as any).phase0.clickType({observationId:id,x:65,y:425,text:'stale'}),{id:shot.observation.id}),/stale-observation/);
      await writeFile(`.local/evidence/extension-${dpr}-${zoom}-${active}.png`,png);
      results.push({dpr,zoom,active,context:shot.context,viewport:shot.observation.viewport,screenshot:{width,height,pixelsPerCSS:width/shot.observation.viewport.clientWidth},input:observed.includes(typed)?'passed':'failed',reusedObservation:'rejected'});
    }
    if (native && dpr===1) {
      await worker.evaluate(async id=>{await (globalThis as any).chrome.tabs.setZoom(id,1);await (globalThis as any).chrome.tabs.update(id,{active:true});},assigned.tabId);
      const captureContext = await worker.evaluate(()=> (globalThis as any).phase0.screenshot());
      const captured = await nativeProbe(agent); results.push({native:captured,extensionBinding:captureContext.context,tabId:assigned.tabId});
      if (captured.verdict!=='passed') process.exitCode=2;
    }
    await agent.goto('about:blank');
    await assert.rejects(worker.evaluate(()=> (globalThis as any).phase0.screenshot()), /scope-lost|no-assigned-tab|No tab|not attached/);
    await context.close(); context=undefined;
  }
  const result = {mode:'live-extension-in-isolated-Chrome-for-Testing',headed,extensionId:id,results};
  await writeFile(`.local/evidence/browser-${headed?'headed':'headless'}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {
  await context?.close(); await relay?.close(); await fixture.close();
  await rm(root,{recursive:true,force:true});
}
