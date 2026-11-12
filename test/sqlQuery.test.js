'use strict';

const assert = require('assert');
const { runnableSql, checkedSql, sourceOffset, attributeFromSaved } = require('../sqlQuery');

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

test('the query saved in SSMS comes back as the same attribute when nothing was changed there', () => {
  const original = '\r\nselect d.Id, \'""a""\' T\r\nfrom Deputies d\r\nwhere d.SubstitutorId = @$SubstitutorId and d.CreatorId = @UserEmployeeId\r\n';
  // as openInSsms writes it (CRLF throughout) and SSMS saves it (a BOM)
  const saved = String.fromCharCode(0xfeff) + runnableSql(original, 'grid insert', 'Wartości').replace(/\r?\n/g, '\r\n');
  // the inner lines come back as LF, which VS Code makes the page's own line end as it applies the edit
  assert.deepStrictEqual(attributeFromSaved(saved, original, '@"'), { text: original.replace(/\r\n/g, '\n').replace(/^\n/, '\r\n').replace(/\n$/, '\r\n') });
});

test('an edit in SSMS comes back with its quotes doubled, the declares and the values given to them left out', () => {
  const original = '\nselect @UserEmployeeId\n';
  const saved = runnableSql(original, 'grid select').replace('= null', '= 41') + 'union select 2 \'"x"\'\n';
  assert.deepStrictEqual(attributeFromSaved(saved, original, '@"'), { text: '\nselect @UserEmployeeId\nunion select 2 \'""x""\'\n' });
  const plain = 'select 1';
  assert.deepStrictEqual(attributeFromSaved('select 2\r\n', plain, '"'), { text: 'select 2' });
});

test('what cannot be put back safely says why', () => {
  const original = '\nselect @UserEmployeeId\n';
  const withoutSeparator = runnableSql(original, 'grid select').replace(/^-- -{70}.*\n/m, '');
  assert.deepStrictEqual(attributeFromSaved(withoutSeparator, original, '@"'), { error: 'separator' });
  assert.deepStrictEqual(attributeFromSaved('select 1', 'select {x}', '$@"'), { error: 'interpolated' });
  assert.deepStrictEqual(attributeFromSaved('select \'a\'', 'select 1', "'"), { error: 'quote' });
  assert.deepStrictEqual(attributeFromSaved('select "a"', 'select 1', '"'), { error: 'quote' });
});
