# MD.Orchestra for VS Code

Open a Markdown file as navigable section cards, a heading outline and a map, with per-section notes, tags and optional Claude insights, without leaving VS Code.

> Experimental. Status and open questions: `docs/adr/0001-vscode-extension.md` in the [MD.Orchestra repository](https://github.com/AhmedYousriSobhi/md.orchestra).

## Use it

1. Open a `.md` file.
2. Run **Reopen Editor With…** (or right-click the tab), then pick **MD.Orchestra**. The command **MD.Orchestra: Open with MD.Orchestra** does the same.

MD.Orchestra is an *optional* editor (`priority: option`): VS Code's own text editor stays the default for Markdown.

## Install from source

Until it is published, build the `.vsix` from the repository (Node 20+, git, VS Code 1.90+ with `code` on PATH):

```bash
git clone https://github.com/AhmedYousriSobhi/md.orchestra.git && cd md.orchestra
git checkout dev
npm ci
npm run vscode:package        # builds vscode-extension/md-orchestra-0.0.1.vsix
code --install-extension vscode-extension/md-orchestra-0.0.1.vsix
```

Or in VS Code: Extensions view, **⋯**, **Install from VSIX…**. To update, rebuild and install with `--force`. The full instructions (uninstall, try without installing, tests) are in the repository's [README](https://github.com/AhmedYousriSobhi/md.orchestra#also-in-vs-code-build-the-extension-yourself).

## How it behaves

- **VS Code owns the file.** Every edit you make in MD.Orchestra is applied to the document as a small text edit, so the tab shows the usual dirty dot, **Ctrl/⌘+S** saves, and Undo, Redo, Revert File and hot exit are VS Code's own. A plain text editor on the same file (split view) stays in sync both ways.
- **Single file.** The standalone app's Explorer, folder workspaces, Changes panel, crash-recovery snapshots, file pickers, GitHub browsing and folder search are not shown. Use VS Code's Explorer, Source Control and Search instead. A relative link to another `.md` file opens it in MD.Orchestra.
- **Keyboard.** Ctrl/⌘+S, Ctrl/⌘+Shift+S, Ctrl/⌘+Shift+P and Ctrl/⌘+K belong to VS Code inside this editor.
- **Theme** follows your VS Code color theme.
- **Claude (optional).** Run **MD.Orchestra: Set Claude API Key** (or use Settings inside the editor). The key is stored in VS Code SecretStorage, and requests go from the extension to `api.anthropic.com` only when you ask for an insight. The key never enters the editor's web view. Claude requests are disabled in untrusted workspaces.
- **No telemetry** is sent by this extension.

## License

MIT
