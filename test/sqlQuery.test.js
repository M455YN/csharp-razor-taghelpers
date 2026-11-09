'use strict';

const assert = require('assert');
const { runnableSql } = require('../sqlQuery');

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
  ].join('\n'));
  assert.strictEqual(out.split('\n\n')[0], [
    '-- Values the app gives this query: set them before running it.',
    'declare @OriginalUserEmployeeId int = null',
    'declare @$SubstituteeId int = null',
    'declare @$DateFrom date = null',
    'declare @$privilegeDomainIds table (Value int)',
    'declare @Name nvarchar(max) = null',
  ].join('\n'));
  assert.ok(out.includes(`select 'mail@example.com', '"~{x}"' T`), 'doubled quotes made single');
  assert.ok(!/companyId|notThis/.test(out.split('\n\n')[0]), 'names in comments are not declared');
});
