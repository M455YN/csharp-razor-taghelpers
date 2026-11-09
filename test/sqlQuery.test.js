'use strict';

const assert = require('assert');
const { runnableSql, checkedSql, sourceOffset } = require('../sqlQuery');

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

test('a query declaring all it uses is left as it is', () => {
  assert.strictEqual(runnableSql('\ndeclare @a int = 1\nselect @a\n'), 'declare @a int = 1\nselect @a\n');
});

test('variables the app passes are declared, typed by name; tables, comments and strings are read right', () => {
  const out = runnableSql([
    '/*declare @companyId int = 1*/',
    'declare @chapterId int = dbo.fGetCurrentChapter(@OriginalUserEmployeeId)',
    "select 'mail@example.com', '\"\"~{x}\"\"' T, @@ROWCOUNT -- @notThis",
    'from Deputies d where d.SubstituteeId = @$SubstituteeId and d.DateFrom = @$DateFrom and @chapterId in (0, 1)',
    'insert X select pd.Value from @$privilegeDomainIds pd where @Name = @name',
  ].join('\n'), 'grid-key-value insert');
  assert.strictEqual(out.split('\n\n')[0], [
    '-- Values the app gives this query: set them before running it.',
    'declare @OriginalUserEmployeeId int = null',
    'declare @$SubstituteeId int = null',
    'declare @$DateFrom date = null',
    'declare @$privilegeDomainIds table (Value int)',
    'declare @Name nvarchar(max) = null',
    `-- ${'-'.repeat(70)} grid-key-value insert`,
  ].join('\n'));
  assert.ok(out.includes(`select 'mail@example.com', '"~{x}"' T`), 'doubled quotes made single');
  assert.ok(!/companyId|notThis/.test(out.split('\n\n')[0]), 'names in comments are not declared');
});

test('a syntax error found in the checked SQL points back into the page, past each ""', () => {
  const raw = '\r\nselect \'""a""\' T\r\nwher x = ""b""';
  assert.strictEqual(checkedSql(raw), '\r\nselect \'"a"\' T\r\nwher x = "b"');
  assert.strictEqual(raw.slice(sourceOffset(raw, 2, 0), sourceOffset(raw, 2, 4)), 'wher');
  assert.strictEqual(raw.slice(sourceOffset(raw, 1, 13), sourceOffset(raw, 1, 14)), 'T');
  assert.strictEqual(raw.slice(sourceOffset(raw, 2, 9)), '""b""');
  assert.strictEqual(sourceOffset(raw, 9, 0), raw.length);
});

test('the comment above the declares in the UI language when given', () => {
  assert.ok(runnableSql('select @a', 'grid select', 'Wartości przekazywane przez aplikację: uzupełnij je przed uruchomieniem.')
    .startsWith('-- Wartości przekazywane przez aplikację: uzupełnij je przed uruchomieniem.\ndeclare @a nvarchar(max) = null\n'));
});
