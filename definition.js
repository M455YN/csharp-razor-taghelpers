'use strict';

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kebabToPascal(kebab) {
  return String(kebab || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function classBodyRange(text, className) {
  const re = new RegExp('\\bclass\\s+' + escapeRegExp(className) + '\\b');
  const match = re.exec(text);
  if (!match) return null;
  const start = match.index;
  const after = start + match[0].length;
  const next = text.slice(after).search(/\bclass\s+\w+/);
  const end = next === -1 ? text.length : after + next;
  return { start, end, nameOffset: start + match[0].indexOf(className) };
}

/**
 * Locate a Tag Helper class, or a property (from kebab-case attribute) inside it.
 * @returns {{offset: number, length: number}|null}
 */
function findSymbolInCSharpText(text, className, propertyKebab) {
  if (!text || !className) return null;
  const body = classBodyRange(text, className);
  if (!body) return null;

  if (!propertyKebab) {
    return { offset: body.nameOffset, length: className.length, kind: 'class' };
  }

  const pascal = kebabToPascal(propertyKebab);
  if (!pascal) return null;

  const slice = text.slice(body.start, body.end);
  const propRe = new RegExp(
    'public\\s+[\\w<>\\.\\?\\[\\]\\s]+\\s+(' + escapeRegExp(pascal) + ')\\s*\\{',
    'i'
  );
  const propMatch = propRe.exec(slice);
  if (!propMatch) {
    return {
      offset: body.nameOffset,
      length: className.length,
      kind: 'class',
      missingProperty: true
    };
  }
  const nameOffset = body.start + propMatch.index + propMatch[0].lastIndexOf(propMatch[1]);
  return { offset: nameOffset, length: propMatch[1].length, kind: 'property' };
}

function matchingTagHelpers(tagHelpers, elementName) {
  const name = String(elementName || '').toLowerCase();
  return (tagHelpers || []).filter(
    (th) => th && String(th.elementName || '').toLowerCase() === name
  );
}

module.exports = {
  kebabToPascal,
  findSymbolInCSharpText,
  matchingTagHelpers
};
