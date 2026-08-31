'use strict';

const assert = require('assert');
const { kebabToPascal, findSymbolInCSharpText, matchingTagHelpers, resolveTagHelperDefinitions } = require('../definition');
const { findDefinitionTarget } = require('../folding');

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

test('kebabToPascal', () => {
  assert.strictEqual(kebabToPascal('layout-type'), 'LayoutType');
  assert.strictEqual(kebabToPascal('row-number-p'), 'RowNumberP');
  assert.strictEqual(kebabToPascal('id'), 'Id');
});

test('findSymbolInCSharpText locates class and property', () => {
  const cs = [
    'public class OtherTagHelper { public string Foo { get; set; } }',
    'public class GridTagHelper : BasePartialTagHelper',
    '{',
    '    public string Select { get; set; }',
    '    public bool NewOrder { get; set; }',
    '    public List<KeyValuePair<long, AdvancedPayload>> AdvancedPayload { get; set; }',
    '    public Dictionary<String, object> SqlParameters { get; set; }',
    '}'
  ].join('\n');
  const cls = findSymbolInCSharpText(cs, 'GridTagHelper', null);
  assert.ok(cs.slice(cls.offset, cls.offset + cls.length) === 'GridTagHelper');
  const prop = findSymbolInCSharpText(cs, 'GridTagHelper', 'new-order');
  assert.strictEqual(prop.kind, 'property');
  assert.strictEqual(cs.slice(prop.offset, prop.offset + prop.length), 'NewOrder');
  const prop2 = findSymbolInCSharpText(cs, 'GridTagHelper', 'sql-parameters');
  assert.strictEqual(prop2.kind, 'property');
  assert.strictEqual(cs.slice(prop2.offset, prop2.offset + prop2.length), 'SqlParameters');
  const prop3 = findSymbolInCSharpText(cs, 'GridTagHelper', 'advanced-payload');
  assert.strictEqual(prop3.kind, 'property');
  assert.strictEqual(cs.slice(prop3.offset, prop3.offset + prop3.length), 'AdvancedPayload');
});

test('missing property falls back to class', () => {
  const cs = 'public class GridTagHelper { public string Select { get; set; } }';
  const found = findSymbolInCSharpText(cs, 'GridTagHelper', 'not-a-prop');
  assert.strictEqual(found.kind, 'class');
  assert.strictEqual(found.missingProperty, true);
});

test('findDefinitionTarget on element name and attribute name', () => {
  const text = '<grid id="x" select="@(@"\nselect 1\n")" />';
  const onGrid = findDefinitionTarget(text, text.indexOf('grid'));
  assert.deepStrictEqual(
    { type: onGrid.type, name: onGrid.name },
    { type: 'element', name: 'grid' }
  );
  const onSelect = findDefinitionTarget(text, text.indexOf('select='));
  assert.strictEqual(onSelect.type, 'attribute');
  assert.strictEqual(onSelect.tagName, 'grid');
  assert.strictEqual(onSelect.name, 'select');
  const inSql = findDefinitionTarget(text, text.indexOf('select 1'));
  assert.strictEqual(inSql, null);
});

test('findDefinitionTarget on closing tag', () => {
  const text = '<filters>\nhello\n</filters>';
  const target = findDefinitionTarget(text, text.lastIndexOf('filters'));
  assert.strictEqual(target.type, 'element');
  assert.strictEqual(target.name, 'filters');
});

test('matchingTagHelpers filters by element name', () => {
  const helpers = [
    { elementName: 'grid', className: 'GridTagHelper' },
    { elementName: 'filter', className: 'FilterTagHelper' }
  ];
  assert.strictEqual(matchingTagHelpers(helpers, 'grid').length, 1);
  assert.strictEqual(matchingTagHelpers(helpers, 'GRID')[0].className, 'GridTagHelper');
});

async function runAsyncTests() {
  const cs = 'public class GridTagHelper { public string Select { get; set; } }';
  const razor = '<grid select="x" />';
  const offset = razor.indexOf('select');
  const defs = await resolveTagHelperDefinitions(razor, offset, [
    { elementName: 'grid', className: 'GridTagHelper', file: 'GridTagHelper.cs' }
  ], async () => cs);
  assert.strictEqual(defs.length, 1);
  assert.strictEqual(cs.slice(defs[0].start, defs[0].end), 'Select');
  assert.strictEqual(defs[0].originStart, razor.indexOf('select'));
}

runAsyncTests()
  .then(() => {
    if (!process.exitCode) {
      console.log('All definition tests passed.');
    }
  })
  .catch((err) => {
    console.error('not ok - resolveTagHelperDefinitions');
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
