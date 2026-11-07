import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Dependency-free Node host.
import { startCoordinator } from '../native/messaging-host/coordinator.mjs';
// @ts-expect-error Dependency-free protocol shared with native host.
import { frame, decoder } from '../native/messaging-host/protocol.mjs';
test('real subprocess host, fragmented frames, coalescing, duplicate acknowledgment, invalid length', async () => {
  const dir = await mkdtemp(join(tmpdir(),'harness-relay-'));
  const relay = await startCoordinator(dir);
  const host = spawn(process.execPath,['native/messaging-host/host.mjs'],{env:{...process.env,HARNESS_RUNTIME_DIR:dir}});
  const responses: any[]=[];
  host.stdout.on('data',decoder((m:any)=>responses.push(m),()=>assert.fail('invalid host output')));
  try {
    const message={v:1,kind:'ping',client:'test-client',seq:1};
    const bytes=frame(message); host.stdin.write(bytes.subarray(0,2)); host.stdin.write(Buffer.concat([bytes.subarray(2),bytes]));
    const until=Date.now()+5000;
    while(responses.length<2 && Date.now()<until) await new Promise(r=>setTimeout(r,20));
    assert.equal(responses.length,2);assert.equal(responses[0].duplicate,false);assert.equal(responses[1].duplicate,true);
    const closed=new Promise<number|null>(r=>host.once('exit',r));
    host.stdin.write(Buffer.from([255,255,255,255]));assert.equal(await closed,3);
  } finally { host.kill();await relay.close();await rm(dir,{recursive:true,force:true}); }
});
