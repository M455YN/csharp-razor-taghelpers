const vscode = require('vscode');


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
  let pendingElementName = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const attrMatch = line.match(/\[\s*HtmlTargetElement\s*\(\s*"(.*?)"/);
    if (attrMatch) { pendingElementName = attrMatch[1]; continue; }
    const classDeclMatch = line.match(/class\s+(\w+)\b/);
    if (classDeclMatch) {
      const cName = classDeclMatch[1];
      if (pendingElementName) {
        classElementNames[cName] = pendingElementName;
        pendingElementName = null;
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
    const propRegex =
      /public\s+([\w<>\.\?\[\]\s]+)\s+(\w+)\s*\{\s*get;\s*set;\s*\}/g;
    const valueSuggestions = {};
    let propMatch;
    while ((propMatch = propRegex.exec(text)) !== null) {
      const propType = (propMatch[1] || '').trim();
      const propName = propMatch[2];
      const kebabName = pascalToKebab(propName);
      attributes.push(kebabName);
      if (propertySummaries[propName]) {
        attributeSummaries[kebabName] = propertySummaries[propName];
      }
      if (propType) {
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
      summary: classSummaries[className],
      attributeSummaries,
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
          for (const th of currentTagHelpers) {
            if (tagName && !th.elementName.startsWith(tagName)) {
              continue;
            }
            const elementItem = new vscode.CompletionItem(
              th.elementName,
              vscode.CompletionItemKind.Class
            );
            elementItem.insertText = th.elementName;
            elementItem.sortText = '\u0000' + th.elementName;
            elementItem.detail = `Tag Helper element (${th.className})`;
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
}

function deactivate() {
  currentTagHelpers = [];
}

module.exports = {
  activate,
  deactivate
};