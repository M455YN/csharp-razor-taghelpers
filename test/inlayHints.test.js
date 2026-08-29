'use strict';

const assert = require('assert');
const {
  collectInlayHints,
  simplifyCSharpType
} = require('../inlayHints');

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

const helpers = [
  {
    elementName: 'grid',
    className: 'GridTagHelper',
    attributeTypes: {
      select: 'string',
      'new-order': 'bool'
    },
    attributePropertyNames: {
      select: 'Select',
      'new-order': 'NewOrder'
    }
  }
];

test('simplifyCSharpType maps common C# types', () => {
  assert.strictEqual(simplifyCSharpType('bool'), 'bool');
  assert.strictEqual(simplifyCSharpType('System.Boolean'), 'bool');
  assert.strictEqual(simplifyCSharpType('string?'), 'string?');
  assert.strictEqual(simplifyCSharpType('LayoutType'), 'LayoutType');
  assert.strictEqual(simplifyCSharpType('List<string>'), 'List<string>');
});

test('inlay hints include class, property names, and types', () => {
  const text = '<grid id="x" select="sql" new-order="true" />';
  const hints = collectInlayHints(text, helpers);
  assert.ok(hints.some((h) => h.label.includes('GridTagHelper')));
  assert.ok(hints.some((h) => h.label === 'Select' && h.kind === 'parameter'));
  assert.ok(hints.some((h) => h.label === ': string' && h.kind === 'type'));
  assert.ok(hints.some((h) => h.label === 'NewOrder'));
  assert.ok(hints.some((h) => h.label === ': bool'));
});

test('inlay hints respect showTypes and showPropertyNames options', () => {
  const text = '<grid select="x" />';
  const typesOnly = collectInlayHints(text, helpers, {
    showPropertyNames: false,
    showClassNames: false
  });
  assert.ok(typesOnly.every((h) => h.kind === 'type'));
  assert.ok(typesOnly.some((h) => h.label === ': string'));

  const namesOnly = collectInlayHints(text, helpers, {
    showTypes: false,
    showClassNames: false
  });
  assert.ok(namesOnly.every((h) => h.kind === 'parameter'));
  assert.ok(namesOnly.some((h) => h.label === 'Select'));
});

if (!process.exitCode) {
  console.log('All inlay hint tests passed.');
}
