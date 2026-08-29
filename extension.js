const vscode = require('vscode');
const path = require('path');
const { computeTagHelperFoldingRanges, findAttributeContext, resolveSelectableAttribute } = require('./folding');
const { resolveTagHelperDefinitions } = require('./definition');
const { collectSqlRanges, DEFAULT_SQL_RULES } = require('./sqlHighlight');
const { collectOutline } = require('./outline');
const { collectDiagnostics } = require('./diagnostics');
const { registerWhatsNew } = require('./whatsNew');
const { registerTagHelpersTree } = require('./tagHelpersTree');
const { collectInlayHints, simplifyCSharpType } = require('./inlayHints');


/**
 * In-memory cache of discovered Tag Helpers.
 * Each item: {
 *   className,
 *   baseClassName?,
 *   elementName,
 *   attributeName,
 *   file,
 *   attributes: string[],
 *   summary?: string,
 *   attributeSummaries?: { [attrName: string]: string | undefined },
 *   valueSuggestions?: { [attrName: string]: string[] | undefined } // e.g. enum values
 * }
 */
const CS_EXCLUDE_GLOB = '{**/bin/**,**/obj/**,**/node_modules/**}';

let currentTagHelpers = [];
let isScanning = false;
let outputChannel = null;
let rescanTimeout = null;
let foldingRangesChanged = null;
let diagnosticsRefresh = null;
let tagHelpersTreeRefresh = null;
let inlayHintsRefresh = null;

function debounce(fn, ms) {
  return function () {
    if (rescanTimeout) {
      clearTimeout(rescanTimeout);
    }
    rescanTimeout = setTimeout(() => {
      rescanTimeout = null;
      fn();
    }, ms);
  };
}

function isInsideDoubleQuotedString(textBeforeCursor, maxChars = 80000) {
  const t =
    typeof maxChars === 'number' && maxChars > 0 && textBeforeCursor.length > maxChars
      ? textBeforeCursor.slice(-maxChars)
      : textBeforeCursor;

  let inRegular = false;
  let inVerbatim = false;

  for (let i = 0; i < t.length; i++) {
    const ch = t[i];

    if (inRegular) {
      if (ch === '\\') {
        i += 1; // skip escaped char
        continue;
      }
      if (ch === '"') {
        inRegular = false;
      }
      continue;
    }

    if (inVerbatim) {
      if (ch === '"') {
        // In verbatim strings, "" is an escaped quote
        if (t[i + 1] === '"') {
          i += 1;
          continue;
        }
        inVerbatim = false;
      }
      continue;
    }

    // Start of a verbatim string: @"
    if (ch === '@' && t[i + 1] === '"') {
      inVerbatim = true;
      i += 1;
      continue;
    }

    // Start of a regular string: "
    if (ch === '"') {
      inRegular = true;
    }
  }

  return inRegular || inVerbatim;
}

function isInsideCSharpVerbatimString(textBeforeCursor) {
  // Detects whether the cursor is currently inside a C# verbatim string literal:
  //   @"..."
  //   $@"..."
  //   @$"..."
  // This is used to suppress tag helper completions inside big SQL blocks that
  // are embedded as verbatim strings in Razor attributes.
  let inVerbatim = false;

  for (let i = 0; i < textBeforeCursor.length; i++) {
    const ch = textBeforeCursor[i];

    if (!inVerbatim) {
      // Start patterns:
      // - @"   (verbatim)
      // - $@"  (interpolated verbatim)
      // - @$"  (interpolated verbatim)
      if (ch === '@' && textBeforeCursor[i + 1] === '"') {
        inVerbatim = true;
        i += 1;
        continue;
      }
      if (
        ch === '$' &&
        textBeforeCursor[i + 1] === '@' &&
        textBeforeCursor[i + 2] === '"'
      ) {
        inVerbatim = true;
        i += 2;
        continue;
      }
      if (
        ch === '@' &&
        textBeforeCursor[i + 1] === '$' &&
        textBeforeCursor[i + 2] === '"'
      ) {
        inVerbatim = true;
        i += 2;
        continue;
      }
      continue;
    }

    // In verbatim strings, "" is an escaped quote
    if (ch === '"') {
      if (textBeforeCursor[i + 1] === '"') {
        i += 1;
        continue;
      }
      inVerbatim = false;
    }
  }

  return inVerbatim;
}

/**
 * Convert PascalCase / CamelCase name to kebab-case.
 * Example: "MyButton" -> "my-button", "HTMLInput" -> "html-input"
 */
function pascalToKebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** True if the C# type string is bool (e.g. "bool", "Boolean", "System.Boolean"). */
function isBooleanType(typeName) {
  if (!typeName || typeof typeName !== 'string') return false;
  const t = typeName.trim();
  return t === 'bool' || t === 'Boolean' || t.endsWith('.Boolean');
}

/**
 * Populate globalEnumValues from raw C# text (regex).
 */
function collectEnumsFromText(text, globalEnumValues) {
  const enumRegex = /public\s+enum\s+(\w+)\s*\{([\s\S]*?)\}/g;
  let enumMatch;
  while ((enumMatch = enumRegex.exec(text)) !== null) {
    const enumName = enumMatch[1];
    const body = enumMatch[2];
    const values = [];
    const memberRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:=.*?(?:,|\}|\s*$))/g;
    let m2;
    while ((m2 = memberRegex.exec(body)) !== null) {
      const memberName = m2[1];
      if (memberName === 'public' || memberName === 'enum') continue;
      values.push(memberName);
    }
    if (values.length) {
      globalEnumValues[enumName] = values;
    }
  }
}

/**
 * Regex-based TagHelper extraction from C# source text.
 */
function parseTagHelpersWithRegex(uri, text, globalEnumValues) {
  const lines = text.split(/\r?\n/);
  const result = [];

  // Pass 1 – collect /// <summary> for classes and properties
  const classSummaries = {};
  const propertySummaries = {};
  let pendingSummary = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const summaryStart = line.match(/\/\/\/\s*<summary>\s*(.*)?/);
    if (summaryStart) {
      const summaryLines = [];
      if (summaryStart[1]) summaryLines.push(summaryStart[1].trim());
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.match(/\/\/\/\s*<\/summary>/)) break;
        const mid = l.match(/\/\/\/\s*(.*)/);
        if (mid) summaryLines.push(mid[1].trim());
      }
      pendingSummary = summaryLines.join(' ').trim();
      i = j;
      continue;
    }
    if (pendingSummary) {
      const classMatch = line.match(/class\s+(\w+TagHelper)\b/);
      if (classMatch) {
        classSummaries[classMatch[1]] = pendingSummary;
        pendingSummary = null;
        continue;
      }
      const propMatch = line.match(
        /public\s+[\w<>\.\?\[\]\s]+\s+(\w+)\s*\{\s*get;\s*set;\s*\}/
      );
      if (propMatch) {
        propertySummaries[propMatch[1]] = pendingSummary;
        pendingSummary = null;
        continue;
      }
    }
  }

  // Pass 2 – map [HtmlTargetElement("...")] to the class below it
  const classElementNames = {};
  const classParentTags = {};
  let pendingElementName = null;
  let pendingParentTag = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const attrMatch = line.match(/\[\s*HtmlTargetElement\s*\(\s*"(.*?)"([^\]\n]*)/);
    if (attrMatch) {
      pendingElementName = attrMatch[1];
      const parent = attrMatch[2] && attrMatch[2].match(/ParentTag\s*=\s*"(.*?)"/);
      pendingParentTag = parent ? parent[1] : null;
      continue;
    }
    const classDeclMatch = line.match(/class\s+(\w+)\b/);
    if (classDeclMatch) {
      const cName = classDeclMatch[1];
      if (pendingElementName) {
        classElementNames[cName] = pendingElementName;
        classParentTags[cName] = pendingParentTag;
        pendingElementName = null;
        pendingParentTag = null;
      }
    }
  }

  // Pass 3 – extract classes and their properties
  const classRegex = /class\s+(\w+)\s*(?::\s*([\w<>,\s]+))?/g;
  let match;
  while ((match = classRegex.exec(text)) !== null) {
    const className = match[1];
    const baseClause = match[2] || '';
    const baseClassName = baseClause.split(/[<,\s]/).filter(Boolean)[0] || '';

    const hasHtmlTarget = !!classElementNames[className];
    const looksLikeTagHelper =
      /TagHelper\b/.test(className) || /TagHelper\b/.test(baseClause);

    if (!hasHtmlTarget && !looksLikeTagHelper) continue;

    let elementName = classElementNames[className] || '';
    const baseName = className.replace(/TagHelper$/, '');
    if (!elementName) {
      if (!baseName) continue;
      elementName = pascalToKebab(baseName);
    }

    const attributes = [];
    const attributeSummaries = {};
    const attributeTypes = {};
    const attributePropertyNames = {};
    const propRegex =
      /public\s+([\w<>\.\?\[\]\s]+)\s+(\w+)\s*\{\s*get;\s*set;\s*\}/g;
    const valueSuggestions = {};
    let propMatch;
    while ((propMatch = propRegex.exec(text)) !== null) {
      const propType = (propMatch[1] || '').trim();
      const propName = propMatch[2];
      const kebabName = pascalToKebab(propName);
      attributes.push(kebabName);
      attributePropertyNames[kebabName] = propName;
      if (propertySummaries[propName]) {
        attributeSummaries[kebabName] = propertySummaries[propName];
      }
      if (propType) {
        const simplified = simplifyCSharpType(propType);
        if (simplified) {
          attributeTypes[kebabName] = simplified;
        }
        const simpleType = propType
          .replace(/\?$/, '')
          .split(/[<>\s]/)
          .filter(Boolean)
          .pop();
        if (isBooleanType(simpleType)) {
          valueSuggestions[kebabName] = ['true', 'false'];
        } else if (simpleType && globalEnumValues[simpleType]) {
          valueSuggestions[kebabName] = globalEnumValues[simpleType];
        }
      }
    }

    result.push({
      className,
      baseClassName: baseClassName || null,
      elementName,
      attributeName: elementName,
      file: uri.fsPath,
      attributes,
      parentTag: classParentTags[className] || null,
      summary: classSummaries[className],
      attributeSummaries,
      attributeTypes,
      attributePropertyNames,
      valueSuggestions
    });

    if (outputChannel) {
      outputChannel.appendLine(
        `[C# Razor Tag Helper Support] Found TagHelper (regex): ${className} -> <${elementName}> (${attributes.length} attributes) in ${uri.fsPath}`
      );
    }
  }

  return result;
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

/**
 * Scan workspace C# files for TagHelper classes using regex only (no C# language server).
 */
async function scanForTagHelpers() {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const result = [];

  if (outputChannel) {
    outputChannel.appendLine('[C# Razor Tag Helper Support] Starting scan for TagHelpers...');
  }

  // Collect all .cs file URIs (exclude bin, obj, node_modules for speed)
  const allUris = [];
  for (const folder of vscode.workspace.workspaceFolders) {
    const pattern = new vscode.RelativePattern(folder, '**/*.cs');
    const files = await vscode.workspace.findFiles(pattern, CS_EXCLUDE_GLOB);
    allUris.push(...files);
  }

  // Pass 1 – open every file once, collect enums and cache file content
  const globalEnumValues = Object.create(null);
  const fileDataList = [];

  for (const uri of allUris) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const text = document.getText();
      collectEnumsFromText(text, globalEnumValues);
      fileDataList.push({ uri, text });
    } catch {
      // ignore per-file errors
    }
  }

  // Pass 2 – extract TagHelpers from cached content (regex only)
  for (const { uri, text } of fileDataList) {
    try {
      const entries = parseTagHelpersWithRegex(uri, text, globalEnumValues);
      result.push(...entries);
    } catch (err) {
      console.error('[csharp-custom-taghelpers] Failed to parse', uri.fsPath, err);
    }
  }


  // After scanning all files, merge attributes defined in base TagHelpers into
  // derived TagHelpers. This allows a derived helper to inherit all attributes
  // from its base helper while still defining its own additional attributes.
  const byClassName = Object.create(null);
  for (const th of result) {
    if (th && typeof th.className === 'string') {
      byClassName[th.className] = th;
    }
  }

  for (const th of result) {
    if (!th || !th.baseClassName || !byClassName[th.baseClassName]) {
      continue;
    }

    const base = byClassName[th.baseClassName];
    if (!Array.isArray(base.attributes) || !base.attributes.length) {
      continue;
    }

    const ownAttrs = Array.isArray(th.attributes) ? th.attributes : [];
    const mergedAttrs = [];
    const seen = new Set();

    for (const a of base.attributes) {
      if (!seen.has(a)) {
        seen.add(a);
        mergedAttrs.push(a);
      }
    }
    for (const a of ownAttrs) {
      if (!seen.has(a)) {
        mergedAttrs.push(a);
        seen.add(a);
      }
    }

    th.attributes = mergedAttrs;

    const mergedSummaries = Object.assign({}, base.attributeSummaries || {});
    if (th.attributeSummaries) {
      for (const [key, val] of Object.entries(th.attributeSummaries)) {
        mergedSummaries[key] = val;
      }
    }
    th.attributeSummaries = mergedSummaries;

    const mergedTypes = Object.assign({}, base.attributeTypes || {});
    if (th.attributeTypes) {
      for (const [key, val] of Object.entries(th.attributeTypes)) {
        mergedTypes[key] = val;
      }
    }
    th.attributeTypes = mergedTypes;

    const mergedPropNames = Object.assign({}, base.attributePropertyNames || {});
    if (th.attributePropertyNames) {
      for (const [key, val] of Object.entries(th.attributePropertyNames)) {
        mergedPropNames[key] = val;
      }
    }
    th.attributePropertyNames = mergedPropNames;

    const mergedValues = Object.assign({}, base.valueSuggestions || {});
    if (th.valueSuggestions) {
      for (const [key, val] of Object.entries(th.valueSuggestions)) {
        mergedValues[key] = val;
      }
    }
    th.valueSuggestions = mergedValues;
  }

  return result;
}

async function refreshTagHelpers(showNotification = false) {
  if (isScanning) {
    return;
  }

  isScanning = true;
  try {
    const found = await scanForTagHelpers();
    currentTagHelpers = found;

    if (outputChannel) {
      outputChannel.appendLine(
        `[C# Razor Tag Helper Support] Scan finished. Total TagHelpers: ${found.length}`
      );
    }

    if (foldingRangesChanged) {
      foldingRangesChanged.fire();
    }
    if (typeof diagnosticsRefresh === 'function') {
      diagnosticsRefresh();
    }
    if (typeof tagHelpersTreeRefresh === 'function') {
      tagHelpersTreeRefresh();
    }
    if (typeof inlayHintsRefresh === 'function') {
      inlayHintsRefresh();
    }

    // Notification in the bottom right corner of VS Code after the scan is complete
    vscode.window.showInformationMessage(
      `C# Razor Tag Helpers: ${found.length} TagHelpers found.`
    );
  } catch (err) {
    console.error('[C# Razor Tag Helper Support] Scan failed', err);
    if (showNotification) {
      vscode.window.showErrorMessage('C# Tag Helpers: scan failed, see console for details.');
    }
  } finally {
    isScanning = false;
  }
}

/**
 * Register completion provider for Razor files.
 * Works in .cshtml / .razor alongside the official C# extension.
 */
function registerCompletionProvider(context) {
  // Do not restrict by scheme so it also works
  // for virtual documents used by the C# extension (aspnetcorerazor).
  const selector = [
    { language: 'razor' },
    { language: 'aspnetcorerazor' }
  ];

  // Build trigger characters dynamically based on configuration
  const cfg = vscode.workspace.getConfiguration('csharpRazorTagHelpers');
  const autoTriggerEnumValues = cfg.get(
    'autoTriggerEnumValueSuggestions',
    true
  );

  const triggerCharacters = ['<', ' ', '=', '-'];
  if (autoTriggerEnumValues) {
    triggerCharacters.push('"');
  }
  // Trigger on letters and digits so attributes are suggested when typing on a new line (e.g. after Enter).
  for (let c = 97; c <= 122; c++) triggerCharacters.push(String.fromCharCode(c));
  for (let c = 65; c <= 90; c++) triggerCharacters.push(String.fromCharCode(c));
  for (let c = 48; c <= 57; c++) triggerCharacters.push(String.fromCharCode(c));

  const provider = vscode.languages.registerCompletionItemProvider(
    selector,
    {
      provideCompletionItems(document, position) {
        if (!currentTagHelpers.length) {
          return [];
        }

        // Determine which tag we are inside (e.g. <tag ...|>), including multi-line tags.
        const textBeforeCursor = document.getText(
          new vscode.Range(new vscode.Position(0, 0), position)
        );


        const items = [];

        // Only offer tag helper completions when we're inside an open tag.
        // If the last '>' is after the last '<', we are not inside a tag.
        const lastGt = textBeforeCursor.lastIndexOf('>');
        const lastLt = textBeforeCursor.lastIndexOf('<');
        if (lastLt === -1 || lastLt < lastGt) {
          return [];
        }

        // Also suppress when we're inside a verbatim string literal inside this tag
        // (common for SQL: select="@(@\"...")").
        const cfg = vscode.workspace.getConfiguration(
          'csharpRazorTagHelpers',
          document.uri
        );
        const suppressInStrings = cfg.get(
          'suppressCompletionsInStrings',
          true
        );
        if (suppressInStrings) {
          const openTagText = textBeforeCursor.substring(lastLt);
          if (isInsideCSharpVerbatimString(openTagText)) {
            return [];
          }
        }

        // Use the last '<' before the cursor (most reliable heuristic).
        if (lastLt === -1) {
          return [];
        }

        const afterLtRaw = textBeforeCursor.substring(lastLt + 1);
        const afterLt = afterLtRaw.replace(/^\s*/, '');
        if (!afterLt || afterLt.startsWith('/')) {
          // closing tag or nothing meaningful
          return [];
        }

        const nameMatch = afterLt.match(/^([a-zA-Z0-9\-\:]+)/);
        if (!nameMatch) {
          return [];
        }

        const tagName = nameMatch[1];
        const restAfterName = afterLt.substring(tagName.length);
        const inTagName = !/[\s>]/.test(restAfterName);

        // If we are in the tag name, show only the list of all elements (no attributes)
        if (inTagName) {
          const insertFullTagSnippets = cfg.get('insertFullTagSnippets', true);
          for (const th of currentTagHelpers) {
            if (tagName && !th.elementName.startsWith(tagName)) {
              continue;
            }
            const elementItem = new vscode.CompletionItem(
              th.elementName,
              insertFullTagSnippets
                ? vscode.CompletionItemKind.Snippet
                : vscode.CompletionItemKind.Class
            );
            if (insertFullTagSnippets) {
              elementItem.insertText = new vscode.SnippetString(
                `${th.elementName}>\n\t$0\n</${th.elementName}>`
              );
              elementItem.detail = `Tag Helper snippet (${th.className})`;
            } else {
              elementItem.insertText = th.elementName;
              elementItem.detail = `Tag Helper element (${th.className})`;
            }
            elementItem.sortText = '\u0000' + th.elementName;
            if (th.summary) {
              elementItem.documentation = new vscode.MarkdownString(th.summary);
            } else {
              elementItem.documentation = th.file;
            }
            items.push(elementItem);
          }
          return items;
        }

        // We are past the tag name, inside the attributes section – filter by the current tag
        const activeHelpers = currentTagHelpers.filter(
          (th) => th.elementName === tagName
        );
        if (!activeHelpers.length) {
          return [];
        }

        // Optional: filter attributes by what the user has typed so far (e.g. "lay" → layout-template)
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9\-]+/);
        const prefix = wordRange ? document.getText(wordRange).toLowerCase() : '';

        // Inside an attribute value (e.g. row-number-p="|" or edit-mode="|") – only suggest valid values.
        const openTagText = textBeforeCursor.substring(lastLt);
        const valueAttrMatch = openTagText.match(
          /([a-zA-Z0-9\-\:]+)\s*=\s*["'][^"']*$/
        );
        if (valueAttrMatch) {
          const valueAttrName = valueAttrMatch[1];
          const valueItems = [];
          const seenValues = new Set();

          for (const th of activeHelpers) {
            const vs = th.valueSuggestions || {};
            const vals = vs[valueAttrName];
            if (!Array.isArray(vals) || !vals.length) {
              continue;
            }
            for (const v of vals) {
              if (seenValues.has(v)) continue;
              seenValues.add(v);
              const valItem = new vscode.CompletionItem(
                v,
                vscode.CompletionItemKind.EnumMember
              );
              valItem.insertText = v;
              valItem.sortText = '\u0000' + v;
              valItem.detail = `Value for ${valueAttrName} (${th.className})`;
              valueItems.push(valItem);
            }
          }

          // Only enum/bool have valueSuggestions: return just those, or nothing (no random strings / other attrs).
          if (valueItems.length) {
            return valueItems;
          }
          // Attribute has no value suggestions (e.g. string) – return nothing so we don't suggest other attribute names here.
          return [];
        }

        const seenAttrs = new Set();
        for (const th of activeHelpers) {
          if (!Array.isArray(th.attributes)) {
            continue;
          }
          for (const attrName of th.attributes) {
            if (prefix && !attrName.toLowerCase().startsWith(prefix)) {
              continue;
            }
            if (seenAttrs.has(attrName)) {
              continue;
            }
            seenAttrs.add(attrName);

            const attrItem = new vscode.CompletionItem(
              attrName,
              vscode.CompletionItemKind.Property
            );
            // Insert only attribute name and empty quotes (no type suffix like ": boolean")
            attrItem.insertText = new vscode.SnippetString(
              `${attrName}="$1"$0`
            );
            // Sort before C# LS items (e.g. "row-number-p : boolean") so our attribute-only suggestion is first
            attrItem.sortText = '\u0000' + attrName;
            attrItem.detail = `Tag Helper attribute (${th.className})`;
            const attrSummary =
              th.attributeSummaries && th.attributeSummaries[attrName];
            if (attrSummary) {
              attrItem.documentation = new vscode.MarkdownString(attrSummary);
            } else {
              attrItem.documentation = th.file;
            }
            // If any active helper has value suggestions (bool/enum) for this attr, trigger suggest after insert so the user gets true/false or enum list
            let hasValueSuggestions = false;
            for (const h of activeHelpers) {
              const vs = (h.valueSuggestions || {})[attrName];
              if (Array.isArray(vs) && vs.length) {
                hasValueSuggestions = true;
                break;
              }
            }
            if (hasValueSuggestions) {
              attrItem.command = { command: 'editor.action.triggerSuggest', title: '' };
            }
            items.push(attrItem);
          }
        }

        return items;
      }
    },
    ...triggerCharacters
  );

  context.subscriptions.push(provider);
}

/**
 * VS Code entrypoint.
 */
async function activate(context) {
  outputChannel = vscode.window.createOutputChannel('C# Razor Tag Helper Support');
  outputChannel.appendLine('[C# Razor Tag Helper Support] Extension activated.');
  refreshTagHelpers(false);

  // Command to refresh manually
  const refreshCommand = vscode.commands.registerCommand(
    'csharpRazorTagHelpers.refresh',
    async () => {
      await refreshTagHelpers(true);
    }
  );

  context.subscriptions.push(refreshCommand);

  // Auto-rescan after changes in .cs files (debounced)
  const debouncedRefresh = debounce(() => {
    refreshTagHelpers(false);
  }, 800);
  const csWatcher = vscode.workspace.createFileSystemWatcher('**/*.cs');
  csWatcher.onDidChange(debouncedRefresh);
  csWatcher.onDidCreate(debouncedRefresh);
  csWatcher.onDidDelete(debouncedRefresh);
  context.subscriptions.push(csWatcher);

  // Completion provider for Razor
  registerCompletionProvider(context);

  // Hover provider – shows summaries for tag / attribute
  const selector = [
    { language: 'razor' },
    { language: 'aspnetcorerazor' }
  ];

  const hoverProvider = vscode.languages.registerHoverProvider(selector, {
    provideHover(document, position) {
      if (!currentTagHelpers.length) {
        return undefined;
      }

      const range = document.getWordRangeAtPosition(
        position,
        /[a-zA-Z0-9\-\:]+/
      );
      if (!range) {
        return undefined;
      }

      const word = document.getText(range);

      // 1) Try matching as an element name
      const asElement = currentTagHelpers.find(
        (th) => th.elementName === word
      );
      if (asElement && asElement.summary) {
        return new vscode.Hover(
          new vscode.MarkdownString(`**${word}**\n\n${asElement.summary}`)
        );
      }

      // 2) Try matching as an attribute of any Tag Helper
      for (const th of currentTagHelpers) {
        if (!th.attributes || !th.attributes.includes(word)) {
          continue;
        }
        const attrSummary =
          th.attributeSummaries && th.attributeSummaries[word];
        if (attrSummary) {
          return new vscode.Hover(
            new vscode.MarkdownString(`**${word}**\n\n${attrSummary}`)
          );
        }
      }

      return undefined;
    }
  });

  context.subscriptions.push(hoverProvider);

  registerFoldingRangeProvider(context);
  registerAttributeSelection(context);
  registerGoToDefinition(context);
  registerSqlHighlighting(context);
  registerOutline(context);
  registerDiagnostics(context);
  registerInlayHints(context);
  registerWhatsNew(context);
  tagHelpersTreeRefresh = registerTagHelpersTree(context, () => currentTagHelpers);
}

function razorSelector() {
  return [
    { language: 'razor' },
    { language: 'aspnetcorerazor' },
    { language: 'html', pattern: '**/*.{cshtml,razor}' },
    { pattern: '**/*.cshtml', scheme: 'file' },
    { pattern: '**/*.razor', scheme: 'file' }
  ];
}

function isRazorDocument(document) {
  if (!document) return false;
  return document.languageId === 'razor' || document.languageId === 'aspnetcorerazor';
}

function foldingEnabled(uri) {
  return vscode.workspace
    .getConfiguration('csharpRazorTagHelpers', uri)
    .get('enableFolding', true);
}

/**
 * Folding for discovered Tag Helper elements (including huge multi-line
 * opening tags with SQL in attributes).
 */
function registerFoldingRangeProvider(context) {
  foldingRangesChanged = new vscode.EventEmitter();
  context.subscriptions.push(foldingRangesChanged);

  const provider = vscode.languages.registerFoldingRangeProvider(razorSelector(), {
    onDidChangeFoldingRanges: foldingRangesChanged.event,
    provideFoldingRanges(document, _context, token) {
      if (token.isCancellationRequested) {
        return [];
      }
      if (!foldingEnabled(document.uri) || !currentTagHelpers.length) {
        return [];
      }
      const ranges = computeTagHelperFoldingRanges(
        document.getText(),
        currentTagHelpers
      );
      return ranges.map((r) => new vscode.FoldingRange(r.start, r.end));
    }
  });
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('csharpRazorTagHelpers.enableFolding')) {
        foldingRangesChanged.fire();
      }
    })
  );

  const foldAll = vscode.commands.registerCommand(
    'csharpRazorTagHelpers.foldAll',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isRazorDocument(editor.document)) {
        vscode.window.showInformationMessage(
          'C# Razor Tag Helpers: open a .cshtml or .razor file to fold Tag Helpers.'
        );
        return;
      }
      if (!foldingEnabled(editor.document.uri)) {
        vscode.window.showInformationMessage(
          'C# Razor Tag Helpers: folding is disabled in settings.'
        );
        return;
      }
      const ranges = computeTagHelperFoldingRanges(
        editor.document.getText(),
        currentTagHelpers
      );
      const selectionLines = [...new Set(ranges.map((r) => r.start))];
      if (!selectionLines.length) {
        vscode.window.showInformationMessage(
          'C# Razor Tag Helpers: no foldable Tag Helpers in this file.'
        );
        return;
      }
      await vscode.commands.executeCommand('editor.fold', { selectionLines });
    }
  );

  const unfoldAll = vscode.commands.registerCommand(
    'csharpRazorTagHelpers.unfoldAll',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isRazorDocument(editor.document)) {
        return;
      }
      const ranges = computeTagHelperFoldingRanges(
        editor.document.getText(),
        currentTagHelpers
      );
      const selectionLines = [...new Set(ranges.map((r) => r.start))];
      if (!selectionLines.length) {
        return;
      }
      await vscode.commands.executeCommand('editor.unfold', { selectionLines });
    }
  );

  context.subscriptions.push(foldAll, unfoldAll);
}

function offsetsToRange(document, start, end) {
  if (start == null || end == null || end < start) {
    return undefined;
  }
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

function rangeContainsPosition(range, position) {
  return range && range.contains(position);
}

function chainSelectionRanges(ranges) {
  const unique = [];
  for (const range of ranges) {
    if (!range || range.isEmpty) continue;
    const prev = unique[unique.length - 1];
    if (prev && prev.isEqual(range)) continue;
    unique.push(range);
  }
  if (!unique.length) {
    return undefined;
  }
  let current = new vscode.SelectionRange(unique[unique.length - 1]);
  for (let i = unique.length - 2; i >= 0; i--) {
    current = new vscode.SelectionRange(unique[i], current);
  }
  return current;
}

/**
 * Expand Selection (Shift+Alt+Right) grows from the SQL inside `select`
 * to the whole attribute, then the whole Tag Helper.
 */
function registerAttributeSelection(context) {
  const selectionProvider = vscode.languages.registerSelectionRangeProvider(
    razorSelector(),
    {
      provideSelectionRanges(document, positions) {
        const text = document.getText();
        return positions.map((position) => {
          const offset = document.offsetAt(position);
          const ctx = findAttributeContext(text, offset);
          if (!ctx) {
            return undefined;
          }

          const nested = [];
          const attr = ctx.attribute;
          if (attr && attr.contentStart != null && attr.contentEnd > attr.contentStart) {
            const content = offsetsToRange(
              document,
              attr.contentStart,
              attr.contentEnd
            );
            if (rangeContainsPosition(content, position)) {
              nested.push(content);
            }
          }
          if (attr && attr.valueStart != null) {
            const value = offsetsToRange(document, attr.valueStart, attr.valueEnd);
            if (rangeContainsPosition(value, position)) {
              nested.push(value);
            }
            const wholeAttr = offsetsToRange(
              document,
              attr.nameStart,
              attr.valueEnd != null ? attr.valueEnd : attr.nameEnd
            );
            if (rangeContainsPosition(wholeAttr, position)) {
              nested.push(wholeAttr);
            }
          }
          const tagRange = offsetsToRange(
            document,
            ctx.tag.startIndex,
            ctx.tag.endIndex
          );
          if (rangeContainsPosition(tagRange, position)) {
            nested.push(tagRange);
          }

          return chainSelectionRanges(nested);
        });
      }
    }
  );

  const selectAttr = vscode.commands.registerCommand(
    'csharpRazorTagHelpers.selectAttributeValue',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isRazorDocument(editor.document)) {
        vscode.window.showInformationMessage(
          'C# Razor Tag Helpers: open a .cshtml or .razor file to select an attribute value.'
        );
        return;
      }

      const offset = editor.document.offsetAt(editor.selection.active);
      const ctx = findAttributeContext(editor.document.getText(), offset);
      const attr = resolveSelectableAttribute(ctx);
      if (!attr || attr.contentStart == null || attr.contentEnd <= attr.contentStart) {
        vscode.window.showInformationMessage(
          'C# Razor Tag Helpers: place the cursor inside a Tag Helper (or its select attribute).'
        );
        return;
      }

      const start = editor.document.positionAt(attr.contentStart);
      const end = editor.document.positionAt(attr.contentEnd);
      editor.selection = new vscode.Selection(start, end);
      editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  );

  const copyAttr = vscode.commands.registerCommand(
    'csharpRazorTagHelpers.copyAttributeValue',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isRazorDocument(editor.document)) {
        vscode.window.showInformationMessage(
          'C# Razor Tag Helpers: open a .cshtml or .razor file to copy an attribute value.'
        );
        return;
      }

      const offset = editor.document.offsetAt(editor.selection.active);
      const ctx = findAttributeContext(editor.document.getText(), offset);
      const attr = resolveSelectableAttribute(ctx);
      if (!attr || attr.contentStart == null || attr.contentEnd <= attr.contentStart) {
        vscode.window.showInformationMessage(
          'C# Razor Tag Helpers: place the cursor inside a Tag Helper (or its select attribute).'
        );
        return;
      }

      const value = editor.document.getText(
        new vscode.Range(
          editor.document.positionAt(attr.contentStart),
          editor.document.positionAt(attr.contentEnd)
        )
      );
      await vscode.env.clipboard.writeText(value);
      vscode.window.setStatusBarMessage(
        'C# Razor Tag Helpers: copied ' + attr.name + ' value',
        2500
      );
    }
  );

  context.subscriptions.push(selectionProvider, selectAttr, copyAttr);
}

function registerGoToDefinition(context) {
  async function openCSharpDocument(filePath) {
    if (!filePath) return null;
    try {
      return await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    } catch {
      const base = path.basename(filePath);
      const found = await vscode.workspace.findFiles(
        `**/${base}`,
        CS_EXCLUDE_GLOB,
        1
      );
      if (!found.length) return null;
      return vscode.workspace.openTextDocument(found[0]);
    }
  }

  async function loadFileText(filePath) {
    const doc = await openCSharpDocument(filePath);
    return doc ? doc.getText() : null;
  }

  async function provideDefinitions(document, position) {
    if (!currentTagHelpers.length) {
      return null;
    }
    const text = document.getText();
    const offset = document.offsetAt(position);
    const resolved = await resolveTagHelperDefinitions(
      text,
      offset,
      currentTagHelpers,
      loadFileText
    );
    if (!resolved.length) {
      return null;
    }

    const locations = [];
    for (const item of resolved) {
      const csDoc = await openCSharpDocument(item.file);
      if (!csDoc) continue;
      const targetRange = new vscode.Range(
        csDoc.positionAt(item.start),
        csDoc.positionAt(item.end)
      );
      locations.push(new vscode.Location(csDoc.uri, targetRange));
    }

    if (!locations.length) {
      return null;
    }
    // Location[] — reliable F12; LocationLink[] alone breaks Go to Definition in Razor.
    return locations.length === 1 ? locations[0] : locations;
  }

  const provider = vscode.languages.registerDefinitionProvider(razorSelector(), {
    provideDefinition(document, position) {
      return provideDefinitions(document, position);
    }
  });
  context.subscriptions.push(provider);
}

function registerSqlHighlighting(context) {
  const decorationTypes = {
    keyword: vscode.window.createTextEditorDecorationType({
      color: new vscode.ThemeColor('csharpRazorTagHelpers.sql.keyword')
    }),
    comment: vscode.window.createTextEditorDecorationType({
      color: new vscode.ThemeColor('csharpRazorTagHelpers.sql.comment'),
      fontStyle: 'italic'
    }),
    string: vscode.window.createTextEditorDecorationType({
      color: new vscode.ThemeColor('csharpRazorTagHelpers.sql.string')
    }),
    number: vscode.window.createTextEditorDecorationType({
      color: new vscode.ThemeColor('csharpRazorTagHelpers.sql.number')
    })
  };
  context.subscriptions.push(...Object.values(decorationTypes));

  const empty = [];
  let timer = null;

  function clearEditor(editor) {
    for (const type of Object.values(decorationTypes)) {
      editor.setDecorations(type, empty);
    }
  }

  function applyEditor(editor) {
    if (!editor || !isRazorDocument(editor.document)) {
      return;
    }
    const cfg = vscode.workspace.getConfiguration(
      'csharpRazorTagHelpers',
      editor.document.uri
    );
    if (!cfg.get('sqlHighlighting.enabled', true)) {
      clearEditor(editor);
      return;
    }
    const rules = cfg.get('sqlHighlighting.rules', DEFAULT_SQL_RULES);
    const text = editor.document.getText();
    const grouped = { keyword: [], comment: [], string: [], number: [] };
    for (const block of collectSqlRanges(text, rules)) {
      for (const token of block.tokens) {
        grouped[token.type].push(
          new vscode.Range(
            editor.document.positionAt(token.start),
            editor.document.positionAt(token.end)
          )
        );
      }
    }
    for (const [type, ranges] of Object.entries(grouped)) {
      editor.setDecorations(decorationTypes[type], ranges);
    }
  }

  function refresh() {
    for (const editor of vscode.window.visibleTextEditors) {
      if (isRazorDocument(editor.document)) {
        applyEditor(editor);
      }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 200);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isRazorDocument(e.document)) schedule();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => schedule()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('csharpRazorTagHelpers.sqlHighlighting')) {
        schedule();
      }
    })
  );

  schedule();
}

function registerOutline(context) {
  const provider = vscode.languages.registerDocumentSymbolProvider(razorSelector(), {
    provideDocumentSymbols(document) {
      if (!currentTagHelpers.length) {
        return [];
      }
      const roots = collectOutline(document.getText(), currentTagHelpers);
      const toSymbol = (node) => {
        const range = new vscode.Range(
          document.positionAt(node.start),
          document.positionAt(node.end)
        );
        const selectionRange = new vscode.Range(
          document.positionAt(node.nameStart),
          document.positionAt(node.nameEnd)
        );
        const symbol = new vscode.DocumentSymbol(
          node.name,
          node.tagName,
          vscode.SymbolKind.Object,
          range,
          selectionRange
        );
        symbol.children = (node.children || []).map(toSymbol);
        return symbol;
      };
      return roots.map(toSymbol);
    }
  });
  context.subscriptions.push(provider);
}

function registerInlayHints(context) {
  const emitter = new vscode.EventEmitter();

  const provider = vscode.languages.registerInlayHintsProvider(razorSelector(), {
    onDidChangeInlayHints: emitter.event,
    provideInlayHints(document, range, token) {
      if (token.isCancellationRequested || !isRazorDocument(document)) {
        return { hints: [] };
      }
      const cfg = vscode.workspace.getConfiguration(
        'csharpRazorTagHelpers',
        document.uri
      );
      if (!cfg.get('inlayHints.enabled', true) || !currentTagHelpers.length) {
        return { hints: [] };
      }

      const text = document.getText();
      const raw = collectInlayHints(text, currentTagHelpers, {
        showTypes: cfg.get('inlayHints.showTypes', true),
        showPropertyNames: cfg.get('inlayHints.showPropertyNames', true),
        showClassNames: cfg.get('inlayHints.showClassNames', true)
      });

      const rangeStart = document.offsetAt(range.start);
      const rangeEnd = document.offsetAt(range.end);
      const hints = [];

      for (const item of raw) {
        if (item.offset < rangeStart || item.offset > rangeEnd) {
          continue;
        }
        const pos = document.positionAt(item.offset);
        const kind =
          item.kind === 'parameter'
            ? vscode.InlayHintKind.Parameter
            : vscode.InlayHintKind.Type;
        const hint = new vscode.InlayHint(pos, item.label, kind);
        if (item.tooltip) {
          hint.tooltip = item.tooltip;
        }
        hints.push(hint);
      }

      return { hints };
    }
  });

  context.subscriptions.push(provider, emitter);
  inlayHintsRefresh = () => emitter.fire(undefined);
}

function registerDiagnostics(context) {
  const collection = vscode.languages.createDiagnosticCollection(
    'csharpRazorTagHelpers'
  );
  context.subscriptions.push(collection);

  function applyDocument(document) {
    if (!isRazorDocument(document)) {
      return;
    }
    const cfg = vscode.workspace.getConfiguration(
      'csharpRazorTagHelpers',
      document.uri
    );
    if (!cfg.get('diagnostics.enabled', true) || !currentTagHelpers.length) {
      collection.delete(document.uri);
      return;
    }
    const items = collectDiagnostics(document.getText(), currentTagHelpers, {
      unknownAttributes: cfg.get('diagnostics.unknownAttributes', true),
      parentTag: cfg.get('diagnostics.parentTag', true),
      closingTags: cfg.get('diagnostics.closingTags', true),
      duplicateAttributes: cfg.get('diagnostics.duplicateAttributes', true)
    });
    collection.set(
      document.uri,
      items.map((d) => {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(
            document.positionAt(d.start),
            document.positionAt(d.end)
          ),
          d.message,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'C# Razor Tag Helpers';
        diagnostic.code = d.code;
        return diagnostic;
      })
    );
  }

  const timers = new Map();

  function scheduleDocument(document) {
    const key = document.uri.toString();
    if (timers.has(key)) {
      clearTimeout(timers.get(key));
    }
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        applyDocument(document);
      }, 250)
    );
  }

  function refresh() {
    for (const t of timers.values()) {
      clearTimeout(t);
    }
    timers.clear();
    for (const document of vscode.workspace.textDocuments) {
      applyDocument(document);
    }
  }

  diagnosticsRefresh = refresh;

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isRazorDocument(e.document)) scheduleDocument(e.document);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (isRazorDocument(document)) scheduleDocument(document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      if (timers.has(key)) {
        clearTimeout(timers.get(key));
        timers.delete(key);
      }
      collection.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('csharpRazorTagHelpers.diagnostics')) {
        refresh();
      }
    })
  );

  refresh();
}

function deactivate() {
  currentTagHelpers = [];
}

module.exports = {
  activate,
  deactivate
};