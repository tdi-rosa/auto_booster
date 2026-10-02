import test from 'node:test';
import assert from 'node:assert/strict';
import { openWithBrowserReport } from '../lib/manual-recovery.js';
import { CaptchaRequiredError } from '../lib/captcha.js';
const blocked = () => { const e = new CaptchaRequiredError({ httpStatus: 403 }); e.partialResult = { session: {}, cards: ['first'], packsOpened: 1 }; return e; };
test('probes once and combines cards when one retry succeeds', async () => {
  let opens = 0, pauses = 0;
  const result = await openWithBrowserReport({}, { open: async () => { if (++opens === 1) throw blocked(); return { session: {}, cards: ['second'], packsOpened: 1 }; }, probe: async () => ({ outcome: 'page_loaded' }), onBlocked: async () => { pauses++; } });
  assert.equal(opens, 2); assert.equal(pauses, 1); assert.deepEqual(result.cards, ['first', 'second']); assert.equal(result.browserDiagnostic.retry.outcome, 'success');
});
test('does not retry when a verification remains visible', async () => {
  let opens = 0;
  await assert.rejects(openWithBrowserReport({}, { open: async () => { opens++; throw blocked(); }, probe: async () => ({ outcome: 'verification_detected_stopped' }), onBlocked: async () => {} }), e => e.browserDiagnostic.retry.attempted === false);
  assert.equal(opens, 1);
});
test('a second block stops and retains cards from both attempts', async () => {
  let opens = 0;
  await assert.rejects(openWithBrowserReport({}, { open: async () => { opens++; throw blocked(); }, probe: async () => ({ outcome: 'page_loaded' }), onBlocked: async () => {} }), e => e.browserDiagnostic.retry.outcome === 'antibot_still_required' && e.partialResult.cards.length === 2);
  assert.equal(opens, 2);
});
