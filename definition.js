'use strict';

const { findDefinitionTarget } = require('./folding');

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
    'public\\s+[\\w<>\\.\\?\\[\\],\\s]+\\s+(' + escapeRegExp(pascal) + ')\\s*\\{',
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

/**
 * Resolve Tag Helper / attribute definitions for Go to Definition and Peek (Alt+F12).
 * @returns {Promise<Array<{file: string, start: number, end: number, originStart: number, originEnd: number}>>}
 */
async function resolveTagHelperDefinitions(text, offset, tagHelpers, loadFileText) {
  if (!text || offset == null || !tagHelpers || !tagHelpers.length) {
    return [];
  }

  const target = findDefinitionTarget(text, offset);
  if (!target) {
    return [];
  }

  const elementName = target.type === 'element' ? target.name : target.tagName;
  const helpers = matchingTagHelpers(tagHelpers, elementName);
  if (!helpers.length) {
    return [];
  }

  const locations = [];
  const seen = new Set();

  const addFromHelper = async (th, kebab) => {
    if (!th || !th.file) return null;
    const key = th.file + '|' + th.className + '|' + (kebab || '');
    if (seen.has(key)) return null;
    seen.add(key);
    const csText = await loadFileText(th.file);
    if (csText == null) return null;
    const found = findSymbolInCSharpText(csText, th.className, kebab || null);
    if (!found || found.missingProperty) {
      return found && found.missingProperty ? found : null;
    }
    locations.push({
      file: th.file,
      start: found.offset,
      end: found.offset + found.length,
      originStart: target.originStart,
      originEnd: target.originEnd
    });
    return found;
  };

  if (target.type === 'element') {
    for (const th of helpers) {
      await addFromHelper(th, null);
    }
  } else {
    for (const th of helpers) {
      const found = await addFromHelper(th, target.name);
      if (found && found.missingProperty && th.baseClassName) {
        const base = tagHelpers.find((h) => h.className === th.baseClassName);
        const baseFound = await addFromHelper(base, target.name);
        if (!baseFound || baseFound.missingProperty) {
          const csText = await loadFileText(th.file);
          if (csText != null) {
            const fallback = findSymbolInCSharpText(csText, th.className, null);
            if (fallback) {
              locations.push({
                file: th.file,
                start: fallback.offset,
                end: fallback.offset + fallback.length,
                originStart: target.originStart,
                originEnd: target.originEnd
              });
            }
          }
        }
      } else if (found && found.missingProperty) {
        const csText = await loadFileText(th.file);
        if (csText != null) {
          const fallback = findSymbolInCSharpText(csText, th.className, null);
          if (fallback) {
            locations.push({
              file: th.file,
              start: fallback.offset,
              end: fallback.offset + fallback.length,
              originStart: target.originStart,
              originEnd: target.originEnd
            });
          }
        }
      }
    }
  }

  return locations;
}

module.exports = {
  kebabToPascal,
  findSymbolInCSharpText,
  matchingTagHelpers,
  resolveTagHelperDefinitions
};
