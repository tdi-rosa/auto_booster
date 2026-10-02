import test from 'node:test';
import assert from 'node:assert/strict';
import { runPrivateDebug } from '../lib/private-debug.js';
const raw = JSON.stringify({id:'12345678-1234-1234-1234-123456789012',reportId:'12345678-1234-1234-1234-123456789013'});
test('one private command opens once across restarts and exports no result secrets', async () => {
  let claimed = false, runs = 0; const logs = [];
  const deps = {claim: async () => {if(claimed)return false;claimed=true;return true;},resolve: async()=> 'target',run:async(id,opts)=>{assert.equal(id,'target');assert.equal(opts.manual,true);runs++;return {ok:false,error:'SECRET'};},write:x=>logs.push(x)};
  await runPrivateDebug(raw,deps); await runPrivateDebug(raw,deps);
  assert.equal(runs,1);assert.equal(logs.at(-1).status,'stopped');assert.ok(!JSON.stringify(logs).includes('SECRET'));
});
test('invalid or unavailable targets never run an opening', async () => {
  let runs=0;const logs=[];const deps={claim:async()=>true,resolve:async()=>null,run:async()=>runs++,write:x=>logs.push(x)};
  await runPrivateDebug('{',deps);await runPrivateDebug(raw,deps);
  assert.equal(runs,0);assert.equal(logs.at(-1).status,'target_unavailable');
});

test('experimental engine is explicit and unknown engines are rejected', async () => {
  const options=[];const deps={claim:async()=>true,resolve:async()=> 'target',run:async(id,opts)=>{options.push(opts);return {ok:true};},write:()=>{}};
  await runPrivateDebug(JSON.stringify({...JSON.parse(raw),engine:'patchright'}),deps);
  await runPrivateDebug(JSON.stringify({...JSON.parse(raw),engine:'unexpected'}),deps);
  for (const engine of ['patchright-chrome', 'patchright-chrome-headed']) {
    await runPrivateDebug(JSON.stringify({...JSON.parse(raw),engine}),deps);
    assert.equal(options.at(-1).browserEngine,engine);
  }
  assert.equal(options.length,3);assert.equal(options[0].browserEngine,'patchright');
});
