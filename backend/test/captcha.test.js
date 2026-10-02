import test from 'node:test';
import assert from 'node:assert/strict';
import { captchaDiagnostic, CaptchaRequiredError } from '../lib/captcha.js';
import { openAllAvailablePacks } from '../lib/wiki.js';

test('records challenge metadata without response secrets', () => {
  const body = JSON.stringify({ error: 'captcha_required', access_token: 'SECRET', email: 'private@example.org', message: 'turnstile required' });
  const report = captchaDiagnostic(new Response(body, { status: 403 }), body, '/api/packs/open');
  assert.equal(report.provider, 'Cloudflare Turnstile');
  assert.deepEqual(report.errorCodes, ['captcha_required']);
  assert.ok(!JSON.stringify(report).includes('SECRET'));
  assert.ok(!JSON.stringify(report).includes('private@example.org'));
});
test('ordinary HTTP errors do not disable automation', () => {
  assert.equal(captchaDiagnostic(new Response('', { status: 401 }), '{"error":"unauthorized"}', '/api/packs/open'), null);
});
test('a CAPTCHA stops on the first request and preserves partial context', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"error":"captcha_required"}', { status: 403 });
  };
  try {
    await assert.rejects(openAllAvailablePacks({ access_token: 'x', refresh_token: 'x', expires_at: Date.now()/1000 + 3600 }), error => {
      assert.ok(error instanceof CaptchaRequiredError);
      assert.equal(error.partialResult.packsOpened, 0);
      return true;
    });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('recognizes the French anti-bot error reported by WikiMasters', () => {
  const body = JSON.stringify({ error: 'Vérification anti-bot requise' });
  assert.ok(captchaDiagnostic(new Response(body, { status: 403 }), body, '/api/packs/open'));
});
