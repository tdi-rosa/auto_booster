import test from 'node:test';
import assert from 'node:assert/strict';
import { findPackLink } from '../lib/pack-navigation.js';
const site = 'https://www.wiki-masters.com';
test('follows Paquets actual href even when profile appears first and path is unfamiliar', () => {
  assert.equal(findPackLink([{ label: 'Profil', href: '/profile', visible: true }, { label: 'Paquets', href: '/real-pack-page', visible: true }], site), site + '/real-pack-page');
});
test('never substitutes profile or follows an external or invisible pack link', () => {
  assert.equal(findPackLink([{ label: 'Profil', href: '/profile', visible: true }, { label: 'Paquets', href: 'https://other.example/packs', visible: true }, { label: 'Paquets', href: '/packs', visible: false }], site), null);
});
