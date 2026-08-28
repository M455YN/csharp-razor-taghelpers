'use strict';

const fs = require('fs');
const path = require('path');

const LAST_VERSION_KEY = 'lastWhatsNewVersion';
const GITHUB_CHANGELOG_URL =
  'https://github.com/M455YN/csharp-razor-taghelpers/blob/main/CHANGELOG.md';
const WHATS_NEW_SCHEME = 'csharpRazorTagHelpers-whatsnew';
const OLD_WEBVIEW_TYPE = 'csharpRazorTagHelpers.whatsNew';

function shouldShowWhatsNew(previousVersion, currentVersion) {
  return Boolean(currentVersion) && previousVersion !== currentVersion;
}

function changelogPath(context) {
  return path.join(context.extensionPath, 'CHANGELOG.md');
}

function readChangelog(context) {
  return fs.readFileSync(changelogPath(context), 'utf8');
}

function whatsNewUri() {
  const vscode = require('vscode');
  return vscode.Uri.from({
    scheme: WHATS_NEW_SCHEME,
    path: "/What's New"
  });
}

async function openWhatsNew(context) {
  const vscode = require('vscode');
  const uri = whatsNewUri();
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== 'markdown') {
    await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
  }
  await vscode.window.showTextDocument(doc, {
    preview: false,
    preserveFocus: false,
    viewColumn: vscode.ViewColumn.Active
  });
}

function registerWhatsNew(context) {
  const vscode = require('vscode');

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(WHATS_NEW_SCHEME, {
      provideTextDocumentContent() {
        return readChangelog(context);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('csharpRazorTagHelpers.showWhatsNew', () =>
      openWhatsNew(context)
    )
  );

  // Dispose leftover custom webviews from earlier builds (they trigger
  // Cursor's "Could not register service worker" error on restore).
  if (typeof vscode.window.registerWebviewPanelSerializer === 'function') {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(OLD_WEBVIEW_TYPE, {
        deserializeWebviewPanel(panel) {
          panel.dispose();
          return Promise.resolve();
        }
      })
    );
  }

  const current = String(
    (context.extension.packageJSON && context.extension.packageJSON.version) || ''
  );
  const previous = context.globalState.get(LAST_VERSION_KEY);
  const autoShow = vscode.workspace
    .getConfiguration('csharpRazorTagHelpers')
    .get('showWhatsNewOnUpdate', true);

  if (!shouldShowWhatsNew(previous, current)) {
    return;
  }

  context.globalState.update(LAST_VERSION_KEY, current);
  if (!autoShow) {
    return;
  }

  const timer = setTimeout(() => {
    openWhatsNew(context);
  }, 1500);
  context.subscriptions.push({
    dispose() {
      clearTimeout(timer);
    }
  });
}

module.exports = {
  LAST_VERSION_KEY,
  GITHUB_CHANGELOG_URL,
  WHATS_NEW_SCHEME,
  shouldShowWhatsNew,
  registerWhatsNew
};
