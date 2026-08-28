'use strict';

const { scanOpeningTags } = require('./folding');

const DEFAULT_SQL_RULES = [
  {
    tag: '*',
    attributes: [
      'select',
      'insert',
      'update',
      'delete',
      'move',
      'lookup-sql',
      'sql'
    ]
  }
];

const SQL_KEYWORDS = new Set(
  [
    'add',
    'all',
    'alter',
    'and',
    'any',
    'apply',
    'as',
    'asc',
    'begin',
    'between',
    'break',
    'by',
    'case',
    'cast',
    'catch',
    'clustered',
    'coalesce',
    'commit',
    'convert',
    'count',
    'create',
    'cross',
    'cursor',
    'date',
    'datetime',
    'decimal',
    'declare',
    'default',
    'delete',
    'desc',
    'distinct',
    'drop',
    'else',
    'end',
    'except',
    'exec',
    'execute',
    'exists',
    'fetch',
    'for',
    'foreign',
    'formatmessage',
    'from',
    'full',
    'function',
    'go',
    'group',
    'having',
    'if',
    'in',
    'index',
    'inner',
    'insert',
    'int',
    'intersect',
    'into',
    'is',
    'isnull',
    'join',
    'key',
    'left',
    'like',
    'max',
    'merge',
    'min',
    'not',
    'null',
    'nullif',
    'nvarchar',
    'of',
    'offset',
    'on',
    'or',
    'order',
    'outer',
    'output',
    'over',
    'partition',
    'percent',
    'pivot',
    'primary',
    'proc',
    'procedure',
    'raiserror',
    'return',
    'right',
    'rollback',
    'row_number',
    'select',
    'set',
    'string_agg',
    'stuff',
    'substring',
    'table',
    'then',
    'top',
    'tran',
    'transaction',
    'trigger',
    'try',
    'union',
    'unique',
    'update',
    'use',
    'values',
    'varchar',
    'view',
    'when',
    'where',
    'while',
    'with'
  ]
);

function normalizeRules(rules) {
  if (!Array.isArray(rules) || !rules.length) {
    return DEFAULT_SQL_RULES;
  }
  return rules;
}

function ruleMatches(tagName, attrName, rule) {
  const tag = String(tagName || '').toLowerCase();
  const attr = String(attrName || '').toLowerCase();
  const ruleTag = String((rule && rule.tag) || '*').toLowerCase();
  if (ruleTag !== '*' && ruleTag !== tag) {
    return false;
  }
  const attrs = Array.isArray(rule && rule.attributes) ? rule.attributes : [];
  return attrs.some((a) => {
    const name = String(a || '').toLowerCase();
    return name === '*' || name === attr;
  });
}

function attributeMatchesSqlRules(tagName, attrName, rules) {
  return normalizeRules(rules).some((rule) => ruleMatches(tagName, attrName, rule));
}

function isSqlIdentStart(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isSqlIdentChar(ch) {
  return isSqlIdentStart(ch) || (ch >= '0' && ch <= '9');
}

/**
 * @returns {{start: number, end: number, type: 'keyword'|'comment'|'string'|'number'}[]}
 */
function tokenizeSql(text, start, end) {
  const tokens = [];
  if (start == null || end == null || end <= start) return tokens;

  let i = start;
  while (i < end) {
    const ch = text[i];

    if (ch === '-' && text[i + 1] === '-') {
      let j = i + 2;
      while (j < end && text[j] !== '\n') j += 1;
      tokens.push({ start: i, end: j, type: 'comment' });
      i = j;
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const j = close === -1 || close + 2 > end ? end : close + 2;
      tokens.push({ start: i, end: j, type: 'comment' });
      i = j;
      continue;
    }

    if ((ch === 'N' || ch === 'n') && text[i + 1] === "'") {
      i += 1;
      continue;
    }

    if (ch === "'") {
      let j = i + 1;
      while (j < end) {
        if (text[j] === "'" && text[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (text[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      tokens.push({ start: i, end: j, type: 'string' });
      i = j;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      while (j < end && ((text[j] >= '0' && text[j] <= '9') || text[j] === '.')) {
        j += 1;
      }
      tokens.push({ start: i, end: j, type: 'number' });
      i = j;
      continue;
    }

    if (isSqlIdentStart(ch)) {
      let j = i + 1;
      while (j < end && isSqlIdentChar(text[j])) j += 1;
      const word = text.slice(i, j);
      if (SQL_KEYWORDS.has(word.toLowerCase())) {
        tokens.push({ start: i, end: j, type: 'keyword' });
      }
      i = j;
      continue;
    }

    i += 1;
  }

  return tokens;
}

function collectSqlRanges(text, rules) {
  const matched = [];
  const tags = scanOpeningTags(text);
  for (const tag of tags) {
    for (const attr of tag.attributes || []) {
      if (
        attr.contentStart == null ||
        attr.contentEnd == null ||
        attr.contentEnd <= attr.contentStart
      ) {
        continue;
      }
      if (!attributeMatchesSqlRules(tag.name, attr.name, rules)) {
        continue;
      }
      matched.push({
        tag: tag.name,
        attribute: attr.name,
        start: attr.contentStart,
        end: attr.contentEnd,
        tokens: tokenizeSql(text, attr.contentStart, attr.contentEnd)
      });
    }
  }
  return matched;
}

module.exports = {
  DEFAULT_SQL_RULES,
  attributeMatchesSqlRules,
  tokenizeSql,
  collectSqlRanges,
  normalizeRules
};
