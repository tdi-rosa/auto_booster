import test from 'node:test';
import assert from 'node:assert/strict';
import { publicResource, safeRoute, reportFindings } from '../lib/browser-report.js';
test('URLs exclude account IDs and query tokens', () => {
  const text = JSON.stringify(publicResource('https://www.wiki-masters.com/profile/private-account?token=secret-token'));
  assert.equal(text.includes('private-account'), false); assert.equal(text.includes('secret-token'), false);
  assert.equal(safeRoute('/profile/private-account'), '/profile/[masqué]');
  assert.equal(publicResource('https://x.supabase.co/auth/v1/user?apikey=secret').endpoint, '/auth/v1/user');
});
test('a successful cookie check alone never proves account identity', () => {
  const findings = reportFindings({ timeline: [], authentication: { cookieCheck: { status: 200 }, accountMatch: null }, failures: [], pageErrors: [] });
  assert.equal(findings[0].code, 'account_not_confirmed'); assert.equal(findings[0].certainty, 'unknown');
});
test('reports observed account mismatch and explicit cookie rejection', () => {
  const codes = reportFindings({ timeline: [], authentication: { cookieCheck: { status: 401 }, accountMatch: false }, failures: [], pageErrors: [] }).map(f => f.code);
  assert.ok(codes.includes('different_account')); assert.ok(codes.includes('cookie_authentication_rejected'));
});
