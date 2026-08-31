'use strict';

const assert = require('assert');
const { parseTagHelpersWithRegex } = require('../tagHelperScan');
const { collectDiagnostics } = require('../diagnostics');

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

test('parseTagHelpersWithRegex includes List and Dictionary properties', () => {
  const cs = [
    'public class GridTagHelper : TagHelper',
    '{',
    '    public string Select { get; set; }',
    '    public Dictionary<String, object> SqlParameters { get; set; }',
    '    public List<KeyValuePair<long, AdvancedPayload>> AdvancedPayload { get; set; }',
    '}'
  ].join('\n');
  const helpers = parseTagHelpersWithRegex({ fsPath: 'GridTagHelper.cs' }, cs, {});
  assert.strictEqual(helpers.length, 1);
  assert.ok(helpers[0].attributes.includes('select'));
  assert.ok(helpers[0].attributes.includes('sql-parameters'));
  assert.ok(helpers[0].attributes.includes('advanced-payload'));
});

test('sql-parameters is not reported as unknown attribute', () => {
  const cs = [
    'public class GridTagHelper : TagHelper',
    '{',
    '    public Dictionary<String, object> SqlParameters { get; set; }',
    '}'
  ].join('\n');
  const helpers = parseTagHelpersWithRegex({ fsPath: 'GridTagHelper.cs' }, cs, {});
  const text = '<grid id="pars" sql-parameters="pars" />';
  const diags = collectDiagnostics(text, helpers).filter((d) => d.code === 'unknown-attribute');
  assert.strictEqual(diags.length, 0);
});

if (!process.exitCode) {
  console.log('All scan tests passed.');
}
