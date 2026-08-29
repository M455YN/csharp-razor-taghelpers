'use strict';

const vscode = require('vscode');
const { findSymbolInCSharpText } = require('./definition');
const path = require('path');

function registerTagHelpersTree(context, getTagHelpers) {
  const provider = new TagHelpersTreeProvider(getTagHelpers);
  const treeView = vscode.window.createTreeView('csharpRazorTagHelpers.explorer', {
    treeDataProvider: provider,
    showCollapseAll: true
  });

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('csharpRazorTagHelpers.openTagHelperSymbol', (file, className, attribute) =>
      openTagHelperSymbol(file, className, attribute)
    ),
    vscode.commands.registerCommand('csharpRazorTagHelpers.refreshTree', () => provider.refresh())
  );

  return () => provider.refresh();
}

class TagHelpersTreeProvider {
  constructor(getTagHelpers) {
    this.getTagHelpers = getTagHelpers;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    const helpers = this.getTagHelpers() || [];
    if (!element) {
      const byFile = new Map();
      for (const th of helpers) {
        const key = th.file || 'unknown';
        if (!byFile.has(key)) byFile.set(key, []);
        byFile.get(key).push(th);
      }
      const files = Array.from(byFile.keys()).sort((a, b) =>
        path.basename(a).localeCompare(path.basename(b))
      );
      return files.map(
        (file) =>
          new TagHelperFileItem(file, byFile.get(file).sort((a, b) =>
            a.elementName.localeCompare(b.elementName)
          ))
      );
    }
    if (element instanceof TagHelperFileItem) {
      return element.helpers.map((th) => new TagHelperItem(th));
    }
    if (element instanceof TagHelperItem) {
      return (element.helper.attributes || []).map(
        (attr) => new TagHelperAttributeItem(element.helper, attr)
      );
    }
    return [];
  }
}

class TagHelperFileItem extends vscode.TreeItem {
  constructor(file, helpers) {
    super(path.basename(file), vscode.TreeItemCollapsibleState.Expanded);
    this.helpers = helpers;
    this.file = file;
    this.iconPath = new vscode.ThemeIcon('file-code');
    this.contextValue = 'tagHelperFile';
    this.tooltip = file;
  }
}

class TagHelperItem extends vscode.TreeItem {
  constructor(helper) {
    super(helper.elementName, vscode.TreeItemCollapsibleState.Collapsed);
    this.helper = helper;
    this.description = helper.className;
    this.iconPath = new vscode.ThemeIcon('symbol-class');
    this.contextValue = 'tagHelper';
    this.tooltip = helper.summary || helper.className;
    this.command = {
      command: 'csharpRazorTagHelpers.openTagHelperSymbol',
      title: 'Open Tag Helper Class',
      arguments: [helper.file, helper.className, null]
    };
  }
}

class TagHelperAttributeItem extends vscode.TreeItem {
  constructor(helper, attribute) {
    super(attribute, vscode.TreeItemCollapsibleState.None);
    this.helper = helper;
    this.attribute = attribute;
    this.iconPath = new vscode.ThemeIcon('symbol-property');
    this.contextValue = 'tagHelperAttribute';
    const summary =
      helper.attributeSummaries && helper.attributeSummaries[attribute];
    this.tooltip = summary || attribute;
    this.description = summary ? helper.className : undefined;
    this.command = {
      command: 'csharpRazorTagHelpers.openTagHelperSymbol',
      title: 'Open Tag Helper Property',
      arguments: [helper.file, helper.className, attribute]
    };
  }
}

async function openTagHelperSymbol(file, className, attribute) {
  if (!file || !className) return;
  try {
    const doc = await vscode.workspace.openTextDocument(file);
    const found = findSymbolInCSharpText(doc.getText(), className, attribute || null);
    if (!found) {
      vscode.window.showWarningMessage(
        'C# Razor Tag Helpers: symbol not found in ' + path.basename(file)
      );
      return;
    }
    const start = doc.positionAt(found.offset);
    const end = doc.positionAt(found.offset + found.length);
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(start, end),
      preview: false
    });
  } catch (err) {
    vscode.window.showErrorMessage(
      'C# Razor Tag Helpers: could not open ' + path.basename(file)
    );
  }
}

module.exports = {
  registerTagHelpersTree
};
