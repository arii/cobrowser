import { chromium } from 'playwright';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'networking-'));
const extension=resolve('apps/extension/.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const invitations=new Map<string,number>();
const uncertain=false;
const guests=['Maya Chen','Alex Kim','Sam Lee'];
try{
  // Every website request is fulfilled locally. No real account or invitation is used.
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.protocol==='chrome-extension:')return route.continue();
    if(url.hostname==='events.example.test')return route.fulfill({contentType:'text/html',body:`<title>AIE Code Summit hackathon guests</title><h1>Hackathon guests</h1><ul>${guests.map((name,i)=>`<li data-guest><h2 data-guest-name>${name}</h2><p data-guest-company>Acme</p>${i!==1?`<a href="https://www.linkedin.com/in/${name.split(' ')[0].toLowerCase()}">${name}</a>`:''}</li>`).join('')}</ul>`});
    if(url.hostname!=='www.linkedin.com')return route.abort();
    if(url.pathname==='/audit'){const key=url.searchParams.get('guest')!;invitations.set(key,(invitations.get(key)??0)+1);return route.fulfill({body:'ok'});}
    const key=url.pathname.split('/')[2]??'maya',name=guests.find(n=>n.toLowerCase().startsWith(key))??'Maya Chen';
    if(url.pathname.startsWith('/search'))return route.fulfill({contentType:'text/html',body:`<title>Search</title><main><ul>${['alex','alex-other'].map(key=>`<li><h2>Alex Kim</h2><p>Engineer at Acme</p><a href="https://www.linkedin.com/in/${key}">Alex Kim</a></li>`).join('')}</ul></main>`});
    const pending=(invitations.get(key)??0)>0;
    return route.fulfill({contentType:'text/html',body:`<title>${name} | LinkedIn</title><main><section><h1>${name}</h1><p>Engineer at Acme</p><button type="button" id="connect" onclick="document.querySelector('[role=dialog]').hidden=false">${pending?'Pending':'Connect'}</button></section></main><div role="dialog" hidden><button type="button" onclick="fetch('/audit?guest=${key}');document.querySelector('[role=dialog]').hidden=true;${uncertain?'':"document.querySelector('#connect').textContent='Pending'"}">Send without a note</button></div>`});
  });
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const skills=await context.newPage();const errors:string[]=[];skills.on('pageerror',e=>errors.push(e.message));await skills.goto(`chrome-extension://${id}/skills.html`);
  const send=(kind:string,args={})=>skills.evaluate(message=>(globalThis as any).chrome.runtime.sendMessage(message),{kind,...args});
  assert.equal((await send('recording:start')).ok,true);
  const source=await context.newPage();await source.goto('https://events.example.test/guests');await source.bringToFront();await source.waitForTimeout(700);
  const linkedin=await context.newPage();await linkedin.goto('https://www.linkedin.com/in/maya');await linkedin.bringToFront();await linkedin.waitForTimeout(500);
  await linkedin.getByRole('button',{name:'Connect',exact:true}).click();await linkedin.waitForTimeout(250);await linkedin.getByRole('button',{name:'Send without a note',exact:true}).click();await linkedin.waitForTimeout(700);
  const listing=await send('skills:list');assert.equal(listing.ok,true);const candidate=listing.value.candidates.find((s:any)=>s.family==='guest-list-linkedin-v1');assert.ok(candidate,JSON.stringify({listing,recording:await send('recording:status'),stored:await worker.evaluate(()=> (globalThis as any).chrome.storage.local.get(['skillWebsiteStarts']))}));
  assert.equal((await send('skills:save',{key:candidate.key,intent:'Connect with the hackathon guests.'})).ok,true);
  const saved=(await send('skills:list')).value.skills.find((s:any)=>s.family==='guest-list-linkedin-v1');assert.ok(saved);
  assert.equal((await send('skills:activate',{id:saved.id,active:true})).ok,false,'Review is mandatory.');
  const activation=await send('skills:activate',{id:saved.id,active:true,reviewed:true});
  assert.equal(activation.ok,false);assert.match(activation.error,/independent verification/);
  assert.equal((await send('skills:run',{id:saved.id})).ok,false);
  // Forged legacy flags cannot enable an unsupported recipe.
  await worker.evaluate(async id=>{const chrome=(globalThis as any).chrome;const {skillLibrary}=await chrome.storage.local.get('skillLibrary');const skill=skillLibrary.find((s:any)=>s.id===id);skill.active=true;skill.networkingReview={binding:'forged'};skill.approval={verdict:'approved'};await chrome.storage.local.set({skillLibrary});},saved.id);
  assert.equal((await send('skills:run',{id:saved.id})).ok,false);
  const stored=(await send('skills:list')).value.skills.find((s:any)=>s.id===saved.id);assert.equal(stored.active,false);assert.equal(stored.needsVerifier,true);
  assert.ok(stored.memory.howTo.length>=4,'Reusable procedure is saved, rather than just a title.');
  await skills.reload();await skills.waitForTimeout(500);assert.equal(errors.length,0,errors.join(' | '));await skills.getByRole('button',{name:'Refresh examples'}).click();
  await skills.locator('#skills-library > article > details > summary').click();
  await skills.getByText('Independent verification is required for every workflow.',{exact:false}).waitFor();
  assert.equal(await skills.getByRole('button',{name:'Run networking skill'}).count(),0);
  assert.deepEqual([...invitations.values()],[1],'Only the human demonstration sends an invitation.');
  const recorded=(await send('recording:status')).value.events;
  await mkdir('.local/evidence',{recursive:true});await skills.screenshot({path:'.local/evidence/networking.png',fullPage:true});
  await writeFile('.local/evidence/networking.json',JSON.stringify({synthetic:true,candidate,stored,recorded,checks:['cross-tab learning','intent and reusable procedure saved','reload persistence','review cannot bypass verifier','forged flags cannot authorize execution','no automated invitations']},null,2));
  console.log('Networking demonstration learning and persistent recipe passed in the built extension. Unsupported execution remains gated. Synthetic routes only.');
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
