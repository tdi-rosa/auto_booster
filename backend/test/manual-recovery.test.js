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
test('site opening stores cards without making another API opening request', async () => {
  let opens = 0;
  const result = await openWithBrowserReport({}, {
    open: async () => { opens++; throw blocked(); },
    probe: async () => { const report = { outcome: 'booster_opened', opening: { requested: true, clicked: true } }; Object.defineProperty(report, 'openingResult', { value: { session: {}, cards: ['browser'], packsOpened: 1 } }); return report; },
    onBlocked: async () => {}
  });
  assert.equal(opens, 1); assert.deepEqual(result.cards, ['first', 'browser']);
  assert.equal(JSON.stringify(result.browserDiagnostic).includes('openingResult'), false);
});
test('unconfirmed site click stops without another API attempt', async () => {
  let opens = 0;
  await assert.rejects(openWithBrowserReport({}, { open: async () => { opens++; throw blocked(); }, probe: async () => ({ outcome: 'opening_not_confirmed', opening: { requested: true, clicked: true } }), onBlocked: async () => {} }), e => e.browserDiagnostic.retry.via === 'site_button');
  assert.equal(opens, 1);
});
