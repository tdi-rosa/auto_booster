import test from 'node:test';
import assert from 'node:assert/strict';
import { isNonFatalDnsProbe } from '../lib/network-diagnostic.js';
test('separates subdomain DNS probes from failures of main verification host', () => {
  assert.equal(isNonFatalDnsProbe('https://brunhild.challenges.cloudflare.com/path', 'net::ERR_NAME_NOT_RESOLVED'), true);
  assert.equal(isNonFatalDnsProbe('https://challenges.cloudflare.com/path', 'net::ERR_NAME_NOT_RESOLVED'), false);
  assert.equal(isNonFatalDnsProbe('https://brunhild.challenges.cloudflare.com/path', 'net::ERR_FAILED'), false);
  assert.equal(isNonFatalDnsProbe('https://unrelated.example/path', 'net::ERR_NAME_NOT_RESOLVED'), false);
});
