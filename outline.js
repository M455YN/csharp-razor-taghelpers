'use strict';

const { collectTagEvents } = require('./folding');

function compactValue(text, start, end, maxLen) {
  if (start == null || end == null || end <= start) return '';
  let value = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (maxLen && value.length > maxLen) {
    value = value.slice(0, maxLen - 1) + '…';
  }
  return value;
}

function outlineLabel(event, text) {
  const attrs = event.attributes || [];
  const idAttr = attrs.find((a) => a.name.toLowerCase() === 'id');
  const idVal = compactValue(text, idAttr && idAttr.contentStart, idAttr && idAttr.contentEnd, 40);
  if (idVal) {
    return event.name + '#' + idVal;
  }
  const keyAttr = attrs.find((a) => {
    const n = a.name.toLowerCase();
    return n === 'parameter-name' || n === 'name';
  });
  const keyVal = compactValue(text, keyAttr && keyAttr.contentStart, keyAttr && keyAttr.contentEnd, 40);
  if (keyVal) {
    return event.name + '[' + keyVal + ']';
  }
  return event.name;
}

function collectOutline(text, tagHelpersOrNames) {
  let nameSet;
  if (tagHelpersOrNames instanceof Set) {
    nameSet = tagHelpersOrNames;
  } else {
    nameSet = new Set();
    for (const item of tagHelpersOrNames || []) {
      const name =
        typeof item === 'string'
          ? item
          : item && item.elementName;
      const n = String(name || '').trim().toLowerCase();
      if (n && n !== '*') nameSet.add(n);
    }
  }

  const roots = [];
  if (!nameSet.size || !text) return roots;

  const helperStack = [];
  const openStack = [];

  function isHelper(name) {
    return nameSet.has(String(name || '').toLowerCase());
  }

  for (const event of collectTagEvents(text)) {
    if (event.type === 'open') {
      const node = isHelper(event.name)
        ? {
            name: outlineLabel(event, text),
            tagName: event.name,
            start: event.startIndex,
            end: event.endIndex,
            nameStart: event.nameStart,
            nameEnd: event.nameEnd,
            children: []
          }
        : null;

      if (node) {
        if (helperStack.length) {
          helperStack[helperStack.length - 1].children.push(node);
        } else {
          roots.push(node);
        }
      }

      if (event.selfClosing) {
        continue;
      }
      openStack.push({ name: event.name.toLowerCase(), node });
      if (node) helperStack.push(node);
      continue;
    }

    const closeName = event.name.toLowerCase();
    for (let i = openStack.length - 1; i >= 0; i--) {
      if (openStack[i].name !== closeName) continue;
      const open = openStack[i];
      openStack.length = i;
      if (open.node) {
        open.node.end = event.endIndex;
        const idx = helperStack.lastIndexOf(open.node);
        if (idx >= 0) helperStack.length = idx;
      }
      break;
    }
  }

  return roots;
}

module.exports = {
  collectOutline,
  outlineLabel
};
