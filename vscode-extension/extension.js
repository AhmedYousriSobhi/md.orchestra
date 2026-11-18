const vscode = require('vscode');
const { MdOrchestraEditorProvider, VIEW_TYPE } = require('./editorProvider');
const aiProxy = require('./aiProxy');

function activate(context) {
  const provider = new MdOrchestraEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      // false, per VS Code's guidance (retaining keeps every hidden webview
      // in memory). A hidden webview is torn down without any event reaching
      // the host, so hosted mode sends each edit as it is typed (no debounce
      // window to lose) and restores the user's place from getState() when
      // the webview is recreated. See ADR 0001.
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('mdOrchestra.setApiKey', async () => {
      const value = await vscode.window.showInputBox({
        title: 'MD.Orchestra: Claude API key',
        prompt: 'Stored in VS Code SecretStorage (OS keychain-backed, not synced). Used only for the requests you trigger.',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'sk-ant-…',
      });
      if (value === undefined) return;
      if (await aiProxy.setApiKey(context.secrets, value)) vscode.window.showInformationMessage('MD.Orchestra: Claude API key saved.');
    }),
    vscode.commands.registerCommand('mdOrchestra.clearApiKey', async () => {
      await aiProxy.clearApiKey(context.secrets);
      vscode.window.showInformationMessage('MD.Orchestra: Claude API key cleared.');
    }),
    vscode.commands.registerCommand('mdOrchestra.openWith', async (uri) => {
      const target = uri || vscode.window.activeTextEditor?.document.uri;
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),
  );

  // Internals are reachable only from the extension-host test suite.
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return { test: { provider, aiProxy, secrets: context.secrets } };
  }
  return undefined;
}

function deactivate() {}

module.exports = { activate, deactivate };
