'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { shouldShowWhatsNew } = require('../whatsNew');

function test(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (err) {
    console.error('not ok - ' + name);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

test('shows on first install and version bump, not same version', () => {
  assert.strictEqual(shouldShowWhatsNew(undefined, '1.3.0'), true);
  assert.strictEqual(shouldShowWhatsNew('1.2.2', '1.3.0'), true);
  assert.strictEqual(shouldShowWhatsNew('1.3.0', '1.3.0'), false);
  assert.strictEqual(shouldShowWhatsNew('1.3.0', ''), false);
});

test('bundled CHANGELOG.md is the GitHub changelog', () => {
  const markdown = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  assert.ok(markdown.startsWith('# Changelog'));
  assert.ok(markdown.includes('## [Unreleased]'));
  assert.ok(markdown.includes('Keep a Changelog'));
  assert.ok(markdown.includes('github.com/M455YN/csharp-razor-taghelpers'));
});

if (!process.exitCode) {
  console.log('All What\'s New tests passed.');
}
