'use strict';

/**
 * Folding ranges for Tag Helper elements in Razor (.cshtml / .razor).
 *
 * Handles the real-world case where a helper's opening tag spans hundreds of
 * lines because an attribute holds a C# verbatim string (e.g. select=@(@"...")).
 * The scanner skips quoted / verbatim / interpolated strings and Razor comments
 * so markup inside SQL does not get treated as tags.
 */

function tagHelperNameSet(tagHelpers) {
  const set = new Set();
  for (const th of tagHelpers || []) {
    const n = String((th && th.elementName) || '').trim().toLowerCase();
    if (n && n !== '*') {
      set.add(n);
    }
  }
  return set;
}

function makePositionAt(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  return function positionAt(offset) {
    if (offset < 0) offset = 0;
    if (offset > text.length) offset = text.length;
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= offset) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const line = hi < 0 ? 0 : hi;
    return { line, character: offset - lineStarts[line] };
  };
}

function isNameChar(ch) {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_' ||
    ch === '-' ||
    ch === ':' ||
    ch === '.'
  );
}

function isNameStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function verbatimOpenLength(text, i) {
  if (text[i] === '$' && text[i + 1] === '@' && text[i + 2] === '"') return 3;
  if (text[i] === '@' && text[i + 1] === '$' && text[i + 2] === '"') return 3;
  if (text[i] === '@' && text[i + 1] === '"') return 2;
  return 0;
}

function skipVerbatim(text, contentStart) {
  for (let i = contentStart; i < text.length; i++) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        i += 1;
        continue;
      }
      return i + 1;
    }
  }
  return text.length;
}

function skipQuoted(text, quoteIndex) {
  const q = text[quoteIndex];
  for (let i = quoteIndex + 1; i < text.length; i++) {
    // HTML attributes often wrap Razor: lookup-sql="@(@" ... ")"
    // The quote that opens @" must not close the attribute.
    if (text[i] === '@') {
      const next = skipRazorAt(text, i);
      if (next > i) {
        i = next - 1;
        continue;
      }
    }
    if (text[i] === q) {
      return i + 1;
    }
  }
  return text.length;
}

/**
 * Skip a Razor token starting at '@': @@, @* *@, @", @(...), @Name(...).
 */
function skipRazorAt(text, i) {
  if (text[i] !== '@') return i;
  if (text[i + 1] === '@') return i + 2;
  if (text[i + 1] === '*') return skipRazorComment(text, i);

  const verbLen = verbatimOpenLength(text, i);
  if (verbLen) return skipVerbatim(text, i + verbLen);

  if (text[i + 1] === '(') {
    return skipBalanced(text, i + 1, '(', ')');
  }

  if (isNameStart(text[i + 1])) {
    let j = i + 2;
    while (j < text.length && isNameChar(text[j])) {
      j += 1;
    }
    if (text[j] === '(') {
      return skipBalanced(text, j, '(', ')');
    }
    if (text[j] === '[') {
      return skipBalanced(text, j, '[', ']');
    }
    return j;
  }

  return i + 1;
}

function skipRazorComment(text, atIndex) {
  const end = text.indexOf('*@', atIndex + 2);
  return end === -1 ? text.length : end + 2;
}

function skipHtmlComment(text, ltIndex) {
  const end = text.indexOf('-->', ltIndex + 4);
  return end === -1 ? text.length : end + 3;
}

function indexOfIgnoreCase(text, needle, from) {
  const n = needle.length;
  for (let i = from; i <= text.length - n; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const a = text[i + j];
      const b = needle[j];
      if (a !== b && a.toLowerCase() !== b) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function skipScriptOrStyle(text, i) {
  if (text[i] !== '<') return i;
  let close = null;
  if (
    text.slice(i, i + 7).toLowerCase() === '<script' &&
    !isNameChar(text[i + 7] || '')
  ) {
    close = '</script>';
  } else if (
    text.slice(i, i + 6).toLowerCase() === '<style' &&
    !isNameChar(text[i + 6] || '')
  ) {
    close = '</style>';
  }
  if (!close) return i;
  const closeAt = indexOfIgnoreCase(text, close, i + 1);
  if (closeAt === -1) return text.length;
  return closeAt + close.length;
}

function skipRazorCommentOrHtmlComment(text, i) {
  if (text[i] === '@' && text[i + 1] === '*') {
    return skipRazorComment(text, i);
  }
  if (text[i] === '<' && text.startsWith('<!--', i)) {
    return skipHtmlComment(text, i);
  }
  return i;
}

/**
 * Trivia to skip while scanning the document (not inside a tag).
 * Single quotes are left alone so English text like "don't" cannot swallow
 * the rest of the file.
 */
function skipTopLevelTrivia(text, i) {
  const commentEnd = skipRazorCommentOrHtmlComment(text, i);
  if (commentEnd !== i) return commentEnd;
  const scriptEnd = skipScriptOrStyle(text, i);
  if (scriptEnd !== i) return scriptEnd;
  const verbLen = verbatimOpenLength(text, i);
  if (verbLen) {
    return skipVerbatim(text, i + verbLen);
  }
  if (text[i] === '"') {
    return skipQuoted(text, i);
  }
  return i;
}

/**
 * Skip a string, Razor comment, or HTML comment starting at i (inside a tag).
 * Returns i unchanged if nothing special starts there.
 */
function skipStringOrComment(text, i) {
  const commentEnd = skipRazorCommentOrHtmlComment(text, i);
  if (commentEnd !== i) return commentEnd;
  const verbLen = verbatimOpenLength(text, i);
  if (verbLen) {
    return skipVerbatim(text, i + verbLen);
  }
  if (text[i] === '"' || text[i] === "'") {
    return skipQuoted(text, i);
  }
  return i;
}

function skipBalanced(text, openIndex, openCh, closeCh) {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const skipped = skipStringOrComment(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = text[i];
    if (ch === openCh) {
      depth += 1;
    } else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
    i += 1;
  }
  return text.length;
}

function peekTagName(text, ltIndex) {
  let i = ltIndex + 1;
  if (i >= text.length) return null;
  const closing = text[i] === '/';
  if (closing) {
    i += 1;
  }
  if (!isNameStart(text[i])) return null;
  const nameStart = i;
  i += 1;
  while (i < text.length && isNameChar(text[i])) {
    i += 1;
  }
  return {
    name: text.slice(nameStart, i),
    closing,
    nameEnd: i
  };
}

/**
 * From '<', find the matching '>' that actually closes the tag, skipping
 * attribute strings and Razor expressions so a '>' inside SQL is ignored.
 */
function parseTag(text, ltIndex) {
  const peeked = peekTagName(text, ltIndex);
  if (!peeked) return null;

  let i = peeked.nameEnd;
  while (i < text.length) {
    const skipped = skipStringOrComment(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const razorEnd = skipRazorAt(text, i);
    if (razorEnd > i) {
      i = razorEnd;
      continue;
    }

    if (text[i] === '>') {
      let j = i - 1;
      while (j > ltIndex && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r' || text[j] === '\n')) {
        j -= 1;
      }
      const selfClosing = !peeked.closing && text[j] === '/';
      return {
        startIndex: ltIndex,
        endIndex: i + 1,
        name: peeked.name,
        closing: peeked.closing,
        selfClosing
      };
    }

    i += 1;
  }
  return null;
}

function pushRange(ranges, start, end) {
  if (end > start) {
    ranges.push({ start, end });
  }
}

/**
 * @param {string} text
 * @param {Iterable<string>|{elementName?: string}[]} tagHelpersOrNames
 * @returns {{start: number, end: number}[]}
 */
function computeTagHelperFoldingRanges(text, tagHelpersOrNames) {
  let nameSet;
  if (tagHelpersOrNames instanceof Set) {
    nameSet = tagHelpersOrNames;
  } else if (
    Array.isArray(tagHelpersOrNames) &&
    tagHelpersOrNames.length &&
    typeof tagHelpersOrNames[0] === 'object'
  ) {
    nameSet = tagHelperNameSet(tagHelpersOrNames);
  } else {
    nameSet = new Set();
    for (const n of tagHelpersOrNames || []) {
      const name = String(n || '').trim().toLowerCase();
      if (name && name !== '*') nameSet.add(name);
    }
  }

  if (!nameSet.size || !text) {
    return [];
  }

  const positionAt = makePositionAt(text);
  const ranges = [];
  const stack = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const skipped = skipTopLevelTrivia(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (text[i] !== '<') {
      i += 1;
      continue;
    }

    const peeked = peekTagName(text, i);
    if (!peeked || !nameSet.has(peeked.name.toLowerCase())) {
      i += 1;
      continue;
    }

    const tag = parseTag(text, i);
    if (!tag) {
      i += 1;
      continue;
    }

    i = tag.endIndex;
    const name = tag.name.toLowerCase();
    const startLine = positionAt(tag.startIndex).line;
    const openEndLine = positionAt(tag.endIndex - 1).line;

    if (tag.closing) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === name) {
          const open = stack[s];
          stack.length = s;
          pushRange(ranges, open.openEndLine, openEndLine);
          break;
        }
      }
      continue;
    }

    if (openEndLine > startLine) {
      pushRange(ranges, startLine, openEndLine);
    }

    if (!tag.selfClosing) {
      stack.push({ name, startLine, openEndLine });
    }
  }

  return ranges;
}

module.exports = {
  tagHelperNameSet,
  computeTagHelperFoldingRanges
};
