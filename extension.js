const vscode = require('vscode');

/**
 * In-memory cache of discovered Tag Helpers.
 * Each item: {
 *   className,
 *   elementName,
 *   attributeName,
 *   file,
 *   attributes: string[],
 *   summary?: string,
 *   attributeSummaries?: { [attrName: string]: string | undefined }
 * }
 */
let currentTagHelpers = [];
let isScanning = false;
let outputChannel = null;

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

/**
 * Scan workspace C# files for classes ending with "TagHelper".
 * Heuristic:
 *   class MyButtonTagHelper -> <my-button> and attributes based on public properties
 */
async function scanForTagHelpers() {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const result = [];

  if (outputChannel) {
    outputChannel.appendLine('[KDR | C# Razor Tag Helpers] Starting scan for TagHelpers...');
  }

  for (const folder of vscode.workspace.workspaceFolders) {
    const pattern = new vscode.RelativePattern(folder, '**/*.cs');
    const files = await vscode.workspace.findFiles(pattern, '**/bin/**');

    for (const uri of files) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const text = document.getText();

        // First pass over lines, collecting /// <summary> for classes and properties
        const lines = text.split(/\r?\n/);
        const classSummaries = {};
        const propertySummaries = {};
        let pendingSummary = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Start summary
          const summaryStart = line.match(/\/\/\/\s*<summary>\s*(.*)?/);
          if (summaryStart) {
            const summaryLines = [];
            if (summaryStart[1]) {
              summaryLines.push(summaryStart[1].trim());
            }
            let j = i + 1;
            for (; j < lines.length; j++) {
              const l = lines[j];
              const end = l.match(/\/\/\/\s*<\/summary>/);
              if (end) {
                break;
              }
              const mid = l.match(/\/\/\/\s*(.*)/);
              if (mid) {
                summaryLines.push(mid[1].trim());
              }
            }
            pendingSummary = summaryLines.join(' ').trim();
            i = j;
            continue;
          }

          // After a summary we expect either a class or a property
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

        // Second lightweight pass: map [HtmlTargetElement("...")] attributes
        // to the next TagHelper class declared below.
        const classElementNames = {};
        let pendingElementName = null;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          const attrMatch = line.match(
            /\[\s*HtmlTargetElement\s*\(\s*"(.*?)"/
          );
          if (attrMatch) {
            pendingElementName = attrMatch[1];
            continue;
          }

          const classDeclMatch = line.match(/class\s+(\w+TagHelper)\b/);
          if (classDeclMatch) {
            const cName = classDeclMatch[1];
            if (pendingElementName) {
              classElementNames[cName] = pendingElementName;
              pendingElementName = null;
            }
          }
        }

        const classRegex = /class\s+(\w+TagHelper)\b/g;
        let match;
        while ((match = classRegex.exec(text)) !== null) {
          const className = match[1];

          // Prefer element name coming from [HtmlTargetElement("...")] directly
          // bound to this class; fall back to kebab-case class name.
          let elementName = classElementNames[className] || '';

          const baseName = className.replace(/TagHelper$/, '');
          if (!elementName) {
            if (!baseName) {
              continue;
            }
            elementName = pascalToKebab(baseName);
          }

          // Collect public properties as potential attributes
          const properties = [];
          const attributeSummaries = {};
          const propRegex =
            /public\s+[\w<>\.\?\[\]\s]+\s+(\w+)\s*\{\s*get;\s*set;\s*\}/g;
          let propMatch;
          while ((propMatch = propRegex.exec(text)) !== null) {
            const propName = propMatch[1];
            const kebabName = pascalToKebab(propName);
            properties.push(kebabName);
            if (propertySummaries[propName]) {
              attributeSummaries[kebabName] = propertySummaries[propName];
            }
          }

          const entry = {
            className,
            elementName,
            attributeName: elementName, // dla prostoty używamy tej samej nazwy
            file: uri.fsPath,
            attributes: properties,
            summary: classSummaries[className],
            attributeSummaries
          };

          result.push(entry);

          if (outputChannel) {
            outputChannel.appendLine(
              `[KDR | C# Razor Tag Helpers] Found TagHelper: ${entry.className} -> <${entry.elementName}> (${entry.attributes.length} attributes) in ${entry.file}`
            );
          }
        }
      } catch (err) {
        console.error('[csharp-custom-taghelpers] Failed to read', uri.fsPath, err);
      }
    }
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
        `[KDR | C# Razor Tag Helpers] Scan finished. Total TagHelpers: ${found.length}`
      );
    }

    if (showNotification) {
      vscode.window.showInformationMessage(
        `KDR | C# Razor Tag Helpers: found ${found.length} TagHelper class(es).`
      );
    }
  } catch (err) {
    console.error('[KDR | C# Razor Tag Helpers] Scan failed', err);
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

  const provider = vscode.languages.registerCompletionItemProvider(
    selector,
    {
      provideCompletionItems(document, position) {
        if (!currentTagHelpers.length) {
          return [];
        }

        const items = [];

        // Determine which tag we are inside (e.g. <frax ...|>), including multi-line tags.
        const textBeforeCursor = document.getText(
          new vscode.Range(new vscode.Position(0, 0), position)
        );

        // Use the last '<' before the cursor (most reliable heuristic).
        const lastLt = textBeforeCursor.lastIndexOf('<');
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
          // Critical: do NOT fall back to all tag helpers here, otherwise
          // attributes get mixed when we mis-detect the active tag.
          return [];
        }

        const seenAttrs = new Set();
        for (const th of activeHelpers) {
          if (!Array.isArray(th.attributes)) {
            continue;
          }
          for (const attrName of th.attributes) {
            if (seenAttrs.has(attrName)) {
              continue;
            }
            seenAttrs.add(attrName);

            const attrItem = new vscode.CompletionItem(
              attrName,
              vscode.CompletionItemKind.Property
            );
            // Insert attribute with ="", cursor placed inside quotes
            attrItem.insertText = new vscode.SnippetString(
              `${attrName}="$1"$0`
            );
            attrItem.detail = `Tag Helper attribute (${th.className})`;
            const attrSummary =
              th.attributeSummaries && th.attributeSummaries[attrName];
            if (attrSummary) {
              attrItem.documentation = new vscode.MarkdownString(attrSummary);
            } else {
              attrItem.documentation = th.file;
            }
            items.push(attrItem);
          }
        }

        return items;
      }
    },
    '<',
    ' '
  );

  context.subscriptions.push(provider);
}

/**
 * VS Code entrypoint.
 */
async function activate(context) {
  outputChannel = vscode.window.createOutputChannel('KDR | C# Razor Tag Helpers');
  outputChannel.appendLine('[KDR | C# Razor Tag Helpers] Extension activated.');
  // Initial scan
  refreshTagHelpers(false);

  // Command to refresh manually
  const refreshCommand = vscode.commands.registerCommand(
    'csharpRazorTagHelpers.refresh',
    async () => {
      await refreshTagHelpers(true);
    }
  );

  context.subscriptions.push(refreshCommand);

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

      // 1) Spróbuj dopasować jako nazwę elementu
      const asElement = currentTagHelpers.find(
        (th) => th.elementName === word
      );
      if (asElement && asElement.summary) {
        return new vscode.Hover(
          new vscode.MarkdownString(`**${word}**\n\n${asElement.summary}`)
        );
      }

      // 2) Spróbuj dopasować jako atrybut dowolnego Tag Helpera
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

