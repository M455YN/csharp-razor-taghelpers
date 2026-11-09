'use strict';

// A Tag Helper's SQL made runnable on its own: the verbatim string's doubled quotes made single, and a DECLARE for each
// variable the app passes in (used but not declared by the query), a table for one read FROM or JOIN.

/** The query's code with comments and string literals blanked, so names in them are not taken for variables. */
function codeOnly(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*|'(?:[^']|'')*'/g, ' ');
}

function typeFor(name, tables) {
  if (tables.has(name.toLowerCase())) return 'table (Value int)';
  if (/date/i.test(name)) return 'date';
  if (/id$/i.test(name)) return 'int';
  return 'nvarchar(max)';
}

/** The attribute's value (the verbatim string's body) as a query to run; label ("grid select") ends the line that
 *  parts the DECLAREs from it, and note (in the UI's language) is the comment above them. */
function runnableSql(raw, label, note) {
  const sql = String(raw).replace(/""/g, '"').trim();
  const code = codeOnly(sql);
  // shortcut: one variable per DECLARE is read (`declare @a int, @b int` declares @b too), add the others if queries do that.
  const declared = new Set([...code.matchAll(/\bdeclare\s+(@[\w@$#]+)/gi)].map((m) => m[1].toLowerCase()));
  const tables = new Set([...code.matchAll(/\b(?:from|join|apply)\s+(@[\w@$#]+)/gi)].map((m) => m[1].toLowerCase()));
  const used = [];
  for (const m of code.matchAll(/(?<![\w@$#])@(?!@)[\w$#][\w@$#]*/g)) {
    const key = m[0].toLowerCase();
    if (!declared.has(key) && !used.some((u) => u.toLowerCase() === key)) used.push(m[0]);
  }
  if (!used.length) return sql + '\n';
  const declares = used.map((name) => (tables.has(name.toLowerCase())
    ? `declare ${name} ${typeFor(name, tables)}`
    : `declare ${name} ${typeFor(name, tables)} = null`));
  return [`-- ${note || 'Values the app gives this query: set them before running it.'}`, ...declares,
    `-- ${'-'.repeat(70)} ${label || "the attribute's SQL"}`, '', sql, ''].join('\n');
}

/** The attribute's SQL as the syntax check reads it: the doubled quotes made single, nothing added, so lines stay the
 *  page's and only columns after a "" move. */
function checkedSql(raw) {
  return String(raw).replace(/""/g, '"');
}

/** Where a 0-based line and column of checkedSql(raw) falls in raw itself, as an offset into raw. */
function sourceOffset(raw, line, character) {
  const checked = checkedSql(raw);
  let at = 0;
  for (let l = 0; l < line && at >= 0; l++) at = checked.indexOf('\n', at) + 1 || -1;
  const target = at < 0 ? checked.length : Math.min(at + character, checked.length);
  let i = 0;
  for (let j = 0; j < target && i < raw.length; j++) i += raw[i] === '"' && raw[i + 1] === '"' ? 2 : 1;
  return i;
}

module.exports = { runnableSql, checkedSql, sourceOffset };
