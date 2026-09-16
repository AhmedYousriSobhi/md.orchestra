<div align="center">

# MD.Orchestra

**Your `.md` folder, but you can actually see it.**

![MD.Orchestra demo](docs/assets/demo.gif)

</div>

You know that folder — forty Markdown files deep, and every time you open
one you're just scrolling, hunting for the one heading you needed. MD.Orchestra
turns it into something you can *navigate*: click through headings like
folders, drop a note on a paragraph without touching its words, drag a
section somewhere else entirely. It all lands right back in the same plain
`.md` files. No database, no lock-in, no "now it's trapped in our app."

## Get it running

No Node, no npm — just [Docker](https://www.docker.com/):

```bash
./build-desktop.sh
./dist/MD.Orchestra-*.AppImage
```

Double-click works too. A real window, your real files, nothing phoning
home.

## The gist

- **Open a file, or a whole folder.** Several at once, if you're like that.
- **Click a heading, get a card.** Edit right there — no "enter edit mode."
- **Hit Map**, and the whole folder lays itself out as a graph you can click through.
- **Ctrl/⌘+S** commits what you're editing. **Ctrl/⌘+Shift+S** writes it to disk.
- **Crash? Power cut?** Next launch offers your unsaved work right back.
- Every shortcut is one `?` away — nothing here to memorize.

That's it. If you're the type who reads changelogs for fun, the rest lives
in **[MORE.md](MORE.md)**.
