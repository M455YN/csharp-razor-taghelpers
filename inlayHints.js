'use strict';

const { collectTagEvents } = require('./folding');
const { matchingTagHelpers, kebabToPascal } = require('./definition');

function isBooleanType(typeName) {
  if (!typeName || typeof typeName !== 'string') return false;
  const t = typeName.trim();
  return t === 'bool' || t === 'Boolean' || t.endsWith('.Boolean');
}

function simplifyCSharpType(propType) {
  if (!propType || typeof propType !== 'string') return null;
  const trimmed = propType.trim();
  const nullable = trimmed.endsWith('?');
  const core = nullable ? trimmed.slice(0, -1).trim() : trimmed;

  const generic = core.match(/^([\w.]+)\s*<\s*([\w<>,.?[\]\s]+)\s*>$/);
  if (generic) {
    const outer = generic[1].split('.').pop();
    const inner = simplifyCSharpType(generic[2]) || generic[2].trim().split(/[\s.]/).pop();
    return outer + '<' + inner + '>' + (nullable ? '?' : '');
  }

  const simple = core.split(/[<>\s]/).filter(Boolean).pop() || core;
  const short = simple.split('.').pop();

  if (isBooleanType(short)) return 'bool' + (nullable ? '?' : '');
  if (short === 'String' || short === 'string') return 'string' + (nullable ? '?' : '');
  if (short === 'Int32' || short === 'int') return 'int' + (nullable ? '?' : '');
  if (short === 'Int64' || short === 'long') return 'long' + (nullable ? '?' : '');
  if (short === 'Double' || short === 'double') return 'double' + (nullable ? '?' : '');
  if (short === 'Decimal' || short === 'decimal') return 'decimal' + (nullable ? '?' : '');
  if (short === 'Single' || short === 'float') return 'float' + (nullable ? '?' : '');
  if (short === 'Object' || short === 'object') return 'object' + (nullable ? '?' : '');

  return short + (nullable ? '?' : '');
}

function mergedMaps(helpers, key) {
  const out = Object.create(null);
  for (const th of helpers) {
    const map = th && th[key];
    if (!map || typeof map !== 'object') continue;
    for (const [name, value] of Object.entries(map)) {
      if (value != null && value !== '') {
        out[name.toLowerCase()] = value;
      }
    }
  }
  return out;
}

/**
 * @returns {Array<{offset: number, label: string, kind: 'type'|'parameter', tooltip?: string}>}
 */
function collectInlayHints(text, tagHelpers, options) {
  const opts = options || {};
  const showTypes = opts.showTypes !== false;
  const showPropertyNames = opts.showPropertyNames !== false;
  const showClassNames = opts.showClassNames !== false;
  const hints = [];

  if (!text || !tagHelpers || !tagHelpers.length) return hints;
  if (!showTypes && !showPropertyNames && !showClassNames) return hints;

  for (const event of collectTagEvents(text)) {
    if (event.type === 'close') continue;

    const helpers = matchingTagHelpers(tagHelpers, event.name);
    if (!helpers.length) continue;

    const types = mergedMaps(helpers, 'attributeTypes');
    const propNames = mergedMaps(helpers, 'attributePropertyNames');

    if (showClassNames) {
      const classes = helpers.map((h) => h.className).filter(Boolean);
      const unique = classes.filter((c, i) => classes.indexOf(c) === i);
      if (unique.length) {
        hints.push({
          offset: event.nameEnd,
          label: ': ' + unique.join(' | '),
          kind: 'type',
          tooltip: 'Tag Helper class'
        });
      }
    }

    for (const attr of event.attributes || []) {
      const key = String(attr.name || '').toLowerCase();
      if (!key) continue;

      const propName = propNames[key] || kebabToPascal(key);
      const typeName = types[key];

      if (showPropertyNames && propName) {
        hints.push({
          offset: attr.nameEnd,
          label: propName,
          kind: 'parameter',
          tooltip: typeName ? 'Type: ' + typeName : undefined
        });
      }

      if (showTypes && typeName) {
        hints.push({
          offset: attr.nameEnd,
          label: ': ' + typeName,
          kind: 'type',
          tooltip: propName ? 'Property: ' + propName : undefined
        });
      }
    }
  }

  return hints;
}

module.exports = {
  collectInlayHints,
  simplifyCSharpType,
  isBooleanType
};
