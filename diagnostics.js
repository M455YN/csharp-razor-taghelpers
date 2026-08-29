'use strict';

const { collectTagEvents } = require('./folding');
const { matchingTagHelpers } = require('./definition');

const HTML_ATTRS = new Set([
  'accesskey',
  'alt',
  'autocomplete',
  'autofocus',
  'checked',
  'class',
  'colspan',
  'contenteditable',
  'controls',
  'dir',
  'disabled',
  'download',
  'draggable',
  'for',
  'form',
  'height',
  'hidden',
  'href',
  'id',
  'inert',
  'itemid',
  'itemprop',
  'itemref',
  'itemscope',
  'itemtype',
  'lang',
  'loop',
  'media',
  'method',
  'multiple',
  'muted',
  'name',
  'placeholder',
  'popover',
  'preload',
  'readonly',
  'rel',
  'required',
  'role',
  'rowspan',
  'selected',
  'slot',
  'spellcheck',
  'src',
  'srcset',
  'style',
  'tabindex',
  'target',
  'title',
  'translate',
  'type',
  'value',
  'width',
  'xmlns'
]);

function isAllowedExtraAttribute(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return true;
  if (HTML_ATTRS.has(n)) return true;
  if (n.startsWith('data-') || n.startsWith('aria-') || n.startsWith('on')) {
    return true;
  }
  if (n.startsWith('asp-') || n.startsWith('bind:') || n.startsWith('@')) {
    return true;
  }
  return false;
}

function allowedParents(helpers) {
  const parents = [];
  let unrestricted = false;
  for (const th of helpers) {
    const p = th && th.parentTag ? String(th.parentTag).trim().toLowerCase() : '';
    if (!p) {
      unrestricted = true;
    } else if (parents.indexOf(p) === -1) {
      parents.push(p);
    }
  }
  return { unrestricted, parents };
}

function isKnownTagHelper(name, tagHelpers) {
  return matchingTagHelpers(tagHelpers, name).length > 0;
}

function collectDiagnostics(text, tagHelpers, options) {
  const opts = options || {};
  const unknownAttributes = opts.unknownAttributes !== false;
  const parentTag = opts.parentTag !== false;
  const closingTags = opts.closingTags !== false;
  const duplicateAttributes = opts.duplicateAttributes !== false;
  const diagnostics = [];
  if (!text || !tagHelpers || !tagHelpers.length) return diagnostics;

  const openStack = [];

  for (const event of collectTagEvents(text)) {
    if (event.type === 'close') {
      const closeName = event.name.toLowerCase();
      const knownClose = isKnownTagHelper(event.name, tagHelpers);

      if (openStack.length === 0) {
        if (closingTags && knownClose) {
          diagnostics.push({
            start: event.nameStart,
            end: event.nameEnd,
            message: 'Unexpected closing tag </' + event.name + '>',
            severity: 'warning',
            code: 'unexpected-close'
          });
        }
        continue;
      }

      const top = openStack[openStack.length - 1];
      if (top.name === closeName) {
        openStack.pop();
        continue;
      }

      const knownOpen = isKnownTagHelper(top.displayName, tagHelpers);
      if (closingTags && (knownClose || knownOpen)) {
        diagnostics.push({
          start: event.nameStart,
          end: event.nameEnd,
          message:
            'Mismatched closing tag: expected </' +
            top.displayName +
            '> but found </' +
            event.name +
            '>',
          severity: 'warning',
          code: 'mismatched-close'
        });
      }

      let matchedIndex = -1;
      for (let i = openStack.length - 1; i >= 0; i--) {
        if (openStack[i].name === closeName) {
          matchedIndex = i;
          break;
        }
      }
      if (matchedIndex >= 0) {
        openStack.length = matchedIndex;
      }
      continue;
    }

    const helpers = matchingTagHelpers(tagHelpers, event.name);
    const parentName = openStack.length ? openStack[openStack.length - 1].name : null;

    if (helpers.length && parentTag) {
      const allowed = allowedParents(helpers);
      if (!allowed.unrestricted && allowed.parents.length) {
        if (!parentName || allowed.parents.indexOf(parentName) === -1) {
          const expected = allowed.parents.map((p) => '<' + p + '>').join(' or ');
          diagnostics.push({
            start: event.nameStart,
            end: event.nameEnd,
            message:
              'Tag Helper <' +
              event.name +
              '> must be nested in ' +
              expected +
              (parentName ? ' (found <' + parentName + '>)' : ' (found top level)'),
            severity: 'warning',
            code: 'parent-tag'
          });
        }
      }
    }

    if (helpers.length && unknownAttributes) {
      const known = new Set();
      let anyAttrs = false;
      for (const th of helpers) {
        if (!Array.isArray(th.attributes) || !th.attributes.length) continue;
        anyAttrs = true;
        for (const a of th.attributes) {
          known.add(String(a).toLowerCase());
        }
      }
      if (anyAttrs) {
        for (const attr of event.attributes || []) {
          const n = String(attr.name || '').toLowerCase();
          if (known.has(n) || isAllowedExtraAttribute(n)) continue;
          diagnostics.push({
            start: attr.nameStart,
            end: attr.nameEnd,
            message: 'Unknown attribute "' + attr.name + '" on <' + event.name + '>',
            severity: 'warning',
            code: 'unknown-attribute'
          });
        }
      }
    }

    if (duplicateAttributes && event.attributes && event.attributes.length) {
      const seen = new Map();
      for (const attr of event.attributes) {
        const n = String(attr.name || '').toLowerCase();
        if (!n) continue;
        if (seen.has(n)) {
          diagnostics.push({
            start: attr.nameStart,
            end: attr.nameEnd,
            message:
              'Duplicate attribute "' +
              attr.name +
              '" on <' +
              event.name +
              '>',
            severity: 'warning',
            code: 'duplicate-attribute'
          });
          continue;
        }
        seen.set(n, attr);
      }
    }

    if (!event.selfClosing) {
      openStack.push({
        name: event.name.toLowerCase(),
        displayName: event.name,
        nameStart: event.nameStart,
        nameEnd: event.nameEnd
      });
    }
  }

  if (closingTags) {
    for (const open of openStack) {
      if (!isKnownTagHelper(open.displayName, tagHelpers)) continue;
      diagnostics.push({
        start: open.nameStart,
        end: open.nameEnd,
        message: 'Missing closing tag for <' + open.displayName + '>',
        severity: 'warning',
        code: 'missing-close'
      });
    }
  }

  return diagnostics;
}

module.exports = {
  collectDiagnostics,
  isAllowedExtraAttribute,
  isKnownTagHelper
};
