'use strict';

const assert = require('assert');
const {
  attributeMatchesSqlRules,
  tokenizeSql,
  collectSqlRanges,
  DEFAULT_SQL_RULES
} = require('../sqlHighlight');

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

test('wildcard tag matches any element', () => {
  const rules = [{ tag: '*', attributes: ['lookup-sql'] }];
  assert.strictEqual(attributeMatchesSqlRules('filter', 'lookup-sql', rules), true);
  assert.strictEqual(attributeMatchesSqlRules('grid', 'lookup-sql', rules), true);
  assert.strictEqual(attributeMatchesSqlRules('grid', 'select', rules), false);
});

test('specific tag does not highlight other helpers', () => {
  const rules = [{ tag: 'grid', attributes: ['select'] }];
  assert.strictEqual(attributeMatchesSqlRules('grid', 'select', rules), true);
  assert.strictEqual(attributeMatchesSqlRules('filter', 'select', rules), false);
  assert.strictEqual(attributeMatchesSqlRules('grid', 'id', rules), false);
});

test('attribute wildcard highlights every attribute of that tag', () => {
  const rules = [{ tag: 'report', attributes: ['*'] }];
  assert.strictEqual(attributeMatchesSqlRules('report', 'sql', rules), true);
  assert.strictEqual(attributeMatchesSqlRules('report', 'id', rules), true);
  assert.strictEqual(attributeMatchesSqlRules('grid', 'sql', rules), false);
});

test('tokenizeSql highlights keywords comments strings numbers', () => {
  const sql = "select 12 from t -- hi\nwhere x = 'a''b' /*c*/";
  const tokens = tokenizeSql(sql, 0, sql.length);
  const byType = (type) =>
    tokens.filter((t) => t.type === type).map((t) => sql.slice(t.start, t.end));
  assert.deepStrictEqual(byType('keyword'), ['select', 'from', 'where']);
  assert.ok(byType('comment').some((c) => c.includes('hi')));
  assert.ok(byType('comment').some((c) => c.includes('c')));
  assert.ok(byType('string').includes("'a''b'"));
  assert.ok(byType('number').includes('12'));
});

test('SelectedP is not treated as SELECT', () => {
  const sql = 'SelectedP';
  const tokens = tokenizeSql(sql, 0, sql.length);
  assert.deepStrictEqual(tokens, []);
});

test('default rules highlight grid select SQL only', () => {
  const text = lines(
    '<grid id="x" select="@(@"',
    'select 1 from dual where id > 0',
    '")" classes="tile" />'
  );
  const blocks = collectSqlRanges(text, DEFAULT_SQL_RULES);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].attribute, 'select');
  const sql = text.slice(blocks[0].start, blocks[0].end);
  assert.ok(sql.includes('select 1 from dual'));
  assert.ok(!sql.includes('classes='));
  const keywords = blocks[0].tokens.filter((t) => t.type === 'keyword');
  assert.ok(keywords.length >= 3);
});

if (!process.exitCode) {
  console.log('All SQL highlighting tests passed.');
}
