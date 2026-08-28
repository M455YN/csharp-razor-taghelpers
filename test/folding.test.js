'use strict';

const assert = require('assert');
const { computeTagHelperFoldingRanges } = require('../folding');

function lines(...rows) {
  return rows.join('\n');
}

function startsEnds(ranges) {
  return ranges.map((r) => [r.start, r.end]);
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

test('empty input', () => {
  assert.deepStrictEqual(computeTagHelperFoldingRanges('', ['grid']), []);
  assert.deepStrictEqual(computeTagHelperFoldingRanges('<grid></grid>', []), []);
});

test('paired tag helper folds from open to close', () => {
  const text = lines('<filters>', '  hello', '</filters>');
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['filters'])), [
    [0, 2]
  ]);
});

test('nested tag helpers', () => {
  const text = lines(
    '<filters>',
    '  <filters-group>',
    '    <filter />',
    '  </filters-group>',
    '</filters>'
  );
  assert.deepStrictEqual(
    startsEnds(computeTagHelperFoldingRanges(text, ['filters', 'filters-group', 'filter'])),
    [
      [1, 3],
      [0, 4]
    ]
  );
});

test('self-closing multi-line opening tag (grid with attributes)', () => {
  const text = lines(
    '<grid id="x"',
    '      layout-type="Modern"',
    '      row-number-p="true" />'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['grid'])), [
    [0, 2]
  ]);
});

test('single-line self-closing tag is not folded', () => {
  const text = '<page-title title="Hi" />';
  assert.deepStrictEqual(computeTagHelperFoldingRanges(text, ['page-title']), []);
});

test('unknown HTML tags are ignored', () => {
  const text = lines('<div>', '  <span>x</span>', '</div>');
  assert.deepStrictEqual(computeTagHelperFoldingRanges(text, ['grid']), []);
});

test('verbatim SQL containing /> and <input> does not close the tag early', () => {
  const text = lines(
    '<grid id="@controlE1"',
    '      select=@(@"',
    'select',
    '  FORMATMESSAGE(N\'<input class=""x"" />\', a.Strength) [Name]',
    'from Codes c',
    '") />'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['grid'])), [
    [0, 5]
  ]);
});

test('regular multi-line quoted attribute containing >', () => {
  const text = lines(
    '<grid id="report-filters-grid"',
    '      select="',
    'select sf.Id[Id:-]',
    'from SqlFields sf',
    'where x > 0',
    '" />'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['grid'])), [
    [0, 5]
  ]);
});

test('Razor @(expr) with comparison does not end the tag at >', () => {
  const text = lines(
    '<grid id="x"',
    '      hide-item-button-p=@(Model.Count > 0)',
    '      />'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['grid'])), [
    [0, 2]
  ]);
});

test('ternary with verbatim string then empty string', () => {
  const text = lines(
    '<grid id="x"',
    '      select=@(Model.editP ? @"',
    'select 1',
    '" : "") />'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['grid'])), [
    [0, 3]
  ]);
});

test('Razor comments hide nested helpers', () => {
  const text = lines(
    '<filters>',
    '@* <grid id="hidden"',
    '         /> *@',
    '</filters>'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['filters', 'grid'])), [
    [0, 3]
  ]);
});

test('HTML comments hide nested helpers', () => {
  const text = lines(
    '<modal>',
    '<!-- <grid id="x"',
    '           /> -->',
    '</modal>'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['modal', 'grid'])), [
    [0, 3]
  ]);
});

test('multi-line open tag plus body: attribute fold and content fold', () => {
  const text = lines(
    '<modal id="x"',
    '       size="Large">',
    '  body',
    '</modal>'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['modal'])), [
    [0, 1],
    [1, 3]
  ]);
});

test('wildcard HtmlTargetElement is ignored', () => {
  const text = lines('<div>', '  x', '</div>');
  assert.deepStrictEqual(
    computeTagHelperFoldingRanges(text, [{ elementName: '*' }]),
    []
  );
});

test('objects with elementName are accepted', () => {
  const text = lines('<grid id="x"', '      />');
  assert.deepStrictEqual(
    startsEnds(computeTagHelperFoldingRanges(text, [{ elementName: 'grid' }])),
    [[0, 1]]
  );
});

test('doubled quotes inside verbatim string', () => {
  const text = lines(
    '<grid select=@(@"',
    'select ""quoted"" [Name]',
    '") />'
  );
  assert.deepStrictEqual(startsEnds(computeTagHelperFoldingRanges(text, ['grid'])), [
    [0, 2]
  ]);
});

test("apostrophe in content does not swallow the next helper", () => {
  const text = lines(
    '<filters>',
    "  don't skip this",
    '  <grid id="x"',
    '        />',
    '</filters>'
  );
  assert.deepStrictEqual(
    startsEnds(computeTagHelperFoldingRanges(text, ['filters', 'grid'])),
    [
      [2, 3],
      [0, 4]
    ]
  );
});

test('quoted Razor verbatim lookup-sql="@(@" does not fold at SQL >', () => {
  const text = lines(
    '<filter auto-refresh="isAutoRefreshFilter" parameter-name="programId" label="@L.p("Program")" type="DropDownList" lookup-sql="@(@"',
    'declare @value int = case when @$$clearP = 1 then null else @programId end',
    '',
    'select',
    '  a.Value',
    'from',
    '(',
    '    select p.Id Value',
    '    from fmNewGradePeriods gp',
    '    inner join ffmNewGetProgramStatus(CAST(@onDate as date)) ps on ps.ProgramId = p.Id and ps.Status > 1',
    '    where gp.Id = @gradePeriodId',
    '    union',
    '    select -p.Id Value',
    '    from fmGradePeriods gp',
    '    inner join ffmGetProgramStatus(CAST(@onDate as date)) ps on ps.ProgramId = p.Id and ps.Status > 1',
    '    where -gp.Id = @gradePeriodId',
    ') a',
    '',
    'drop table #kkk',
    '")" />'
  );
  const ranges = computeTagHelperFoldingRanges(text, ['filter']);
  assert.deepStrictEqual(startsEnds(ranges), [[0, 19]]);
});

test('tag helpers inside script strings are ignored', () => {
  const text = lines(
    '<filters>',
    '<script>',
    "  const x = $('<grid id=\"x\"></grid>')",
    '</script>',
    '</filters>'
  );
  assert.deepStrictEqual(
    startsEnds(computeTagHelperFoldingRanges(text, ['filters', 'grid'])),
    [[0, 4]]
  );
});

if (!process.exitCode) {
  console.log('All folding tests passed.');
}
