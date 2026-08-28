'use strict';

const assert = require('assert');
const { collectOutline } = require('../outline');
const { collectDiagnostics, isAllowedExtraAttribute } = require('../diagnostics');

function lines(...rows) {
  return rows.join('\n');
}

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
    attributes: ['id', 'select', 'new-order', 'classes'],
    parentTag: null
  },
  {
    elementName: 'filter',
    attributes: ['parameter-name', 'lookup-sql', 'type'],
    parentTag: 'filters-group'
  },
  {
    elementName: 'filters-group',
    attributes: ['filters-per-row'],
    parentTag: 'filters'
  },
  {
    elementName: 'filters',
    attributes: ['id'],
    parentTag: null
  }
];

test('outline nests tag helpers and uses id / parameter-name', () => {
  const text = lines(
    '<div>',
    '  <filters id="f1">',
    '    <filters-group>',
    '      <filter parameter-name="programId" />',
    '    </filters-group>',
    '  </filters>',
    '  <grid id="grid-talent-matrix" select="@(@"',
    'select 1',
    '")" />',
    '</div>'
  );
  const roots = collectOutline(text, helpers);
  assert.strictEqual(roots.length, 2);
  assert.strictEqual(roots[0].name, 'filters#f1');
  assert.strictEqual(roots[0].children[0].name, 'filters-group');
  assert.strictEqual(roots[0].children[0].children[0].name, 'filter[programId]');
  assert.strictEqual(roots[1].name, 'grid#grid-talent-matrix');
  assert.ok(roots[1].end > roots[1].start);
});

test('unknown attribute is reported, known and HTML attrs are not', () => {
  const text = '<grid id="x" class="c" hide-item-buton-p="true" new-order="true" />';
  const diags = collectDiagnostics(text, helpers);
  const unknown = diags.filter((d) => d.code === 'unknown-attribute');
  assert.strictEqual(unknown.length, 1);
  assert.ok(unknown[0].message.includes('hide-item-buton-p'));
});

test('filter outside filters-group warns; nested filter does not', () => {
  const bad = '<div><filter parameter-name="x" /></div>';
  const badDiags = collectDiagnostics(bad, helpers).filter((d) => d.code === 'parent-tag');
  assert.strictEqual(badDiags.length, 1);

  const good = lines(
    '<filters>',
    '  <filters-group>',
    '    <filter parameter-name="x" />',
    '  </filters-group>',
    '</filters>'
  );
  const goodDiags = collectDiagnostics(good, helpers).filter((d) => d.code === 'parent-tag');
  assert.strictEqual(goodDiags.length, 0);
});

test('HTML data- and aria- attributes are allowed', () => {
  assert.strictEqual(isAllowedExtraAttribute('data-id'), true);
  assert.strictEqual(isAllowedExtraAttribute('aria-label'), true);
  assert.strictEqual(isAllowedExtraAttribute('hide-item-buton-p'), false);
});

if (!process.exitCode) {
  console.log('All outline/diagnostics tests passed.');
}
