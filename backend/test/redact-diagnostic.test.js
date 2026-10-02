import test from 'node:test';
import assert from 'node:assert/strict';
import { redactDiagnostic } from '../lib/redact-diagnostic.js';
test('removes session secrets, credentials, identifiers and URL queries', () => {
  const source = 'Turnstile Error: 600010 access_token="short-secret" Bearer hidden-bearer https://example.test/?token=query-secret theo@example.test 12345678-1234-1234-1234-123456789abc known-secret';
  const result = redactDiagnostic(source, ['known-secret']);
  for (const secret of ['short-secret', 'hidden-bearer', 'query-secret', 'theo@example.test', '12345678', 'known-secret']) assert.equal(result.includes(secret), false);
  assert.ok(result.includes('600010'));
});
test('retains actionable browser messages and bounds output', () => {
  assert.equal(redactDiagnostic('WebGL context was lost.'), 'WebGL context was lost.');
  assert.ok(redactDiagnostic('error '.repeat(1000)).length <= 800);
});
