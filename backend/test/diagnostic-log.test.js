import test from 'node:test';
import assert from 'node:assert/strict';
import { logBrowserDiagnostic } from '../lib/diagnostic-log.js';

test('private logs reconstruct a rich report and exclude internal opening result', () => {
  const report = { outcome: 'booster_opened', timeline: Array.from({length: 200}, (_, i) => ({ elapsedMs: i, detail: 'é'.repeat(100) })) };
  Object.defineProperty(report, 'openingResult', {value: {session: {access_token: 'SECRET'}, cards: ['private']}, enumerable: false});
  const lines = [];
  const id = logBrowserDiagnostic(report, line => lines.push(JSON.parse(line)));
  assert.ok(lines.length > 1);
  assert.ok(lines.every((entry, i) => entry.reportId === id && entry.part === i + 1 && entry.total === lines.length && entry.data.length <= 4000));
  assert.deepEqual(JSON.parse(lines.map(entry => entry.data).join('')), report);
  assert.ok(!JSON.stringify(lines).includes('SECRET'));
});
