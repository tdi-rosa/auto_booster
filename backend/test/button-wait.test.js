import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForOpeningButton } from '../lib/button-wait.js';
function run(count, enabled) {
  let ms = 0;
  const samples = [];
  return waitForOpeningButton({ button: { count: async () => count(ms), isEnabled: async () => enabled(ms) }, snapshot: async () => samples.push(ms), now: () => ms, sleep: async dt => { ms += dt; }, timeoutMs: 15000 }).then(result => ({ ...result, samples }));
}
test('waits for a delayed button and its enabled state', async () => {
  const r = await run(ms => ms >= 4000 ? 1 : 0, ms => ms >= 7000);
  assert.equal(r.ready, true); assert.equal(r.waitedMs, 7000); assert.equal(r.samples.length, 8);
});
test('distinguishes a missing button from a disabled one at timeout', async () => {
  const missing = await run(() => 0, () => false);
  const disabled = await run(() => 1, () => false);
  assert.equal(missing.seen, false); assert.equal(disabled.seen, true);
  assert.equal(missing.ready, false); assert.equal(disabled.ready, false);
  assert.equal(disabled.waitedMs, 15000);
});
