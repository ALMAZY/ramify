# Ramify

**A keyboard-first mind map for fast notes.** Use it for lectures, meetings, research and planning. You can build a whole map without touching the mouse, and every map is a plain Markdown file in a folder you choose.

![Ramify](docs/screenshot.png)

*ramify* (v.): to branch out.

## Install

**macOS** (Homebrew)

```bash
brew tap almazy/tap
brew trust almazy/tap
brew install --cask ramify
```

**macOS** (manual): download the `.dmg` from [Releases](https://github.com/ALMAZY/ramify/releases/latest).

**Windows:** download the `.msi` or the `-setup.exe` from [Releases](https://github.com/ALMAZY/ramify/releases/latest).

**Linux:** download from [Releases](https://github.com/ALMAZY/ramify/releases/latest), for x64 or arm64:

- `.deb` for Debian, Ubuntu and Mint: `sudo apt install ./Ramify_*.deb`
- `.rpm` for Fedora and openSUSE: `sudo dnf install ./Ramify-*.rpm`
- `.AppImage` for any distro: `chmod +x Ramify_*.AppImage && ./Ramify_*.AppImage`

> **First launch.** The builds are not signed with a paid certificate yet, so your system may warn you once.
> - **macOS** (if you used the `.dmg`): open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**. You can also run `xattr -dr com.apple.quarantine /Applications/Ramify.app`. Homebrew installs skip this step.
> - **Windows** SmartScreen: click **More info → Run anyway**.

## Why Ramify

- **Fast typing.** Type a topic, press `Enter` for the next one, `Tab` to go one level deeper and `Shift+Tab` to come back out. You don't have to stop and think about the tree.
- **No lock-in.** A map is one `.md` file with a nested list. There's no database, account or cloud. It works with Obsidian, VS Code, git and Syncthing.
- **Two views of one map.** The mind map gives you the overview. The outline view (`⌘2`) is for typing at speed.
- **Small and native.** Built with Tauri, so the download is a few MB, not hundreds. Runs on macOS, Windows and Linux.

## Features

- Mind map and right-tree layouts (`⌘L`), automatic layout, coloured branches
- Topic colours: 9 theme-aware colours with `⌥1`–`⌥9`, any custom colour from `⌘⇧C`, `⌥0` for automatic. A colour carries down its branch
- Outline view of the same map
- Markdown notes on any topic (`⌘E`)
- Checkbox topics, none → todo → done (`⌘Enter`)
- Fold and unfold branches, and focus mode to zoom into one branch (`⌘]` / `⌘[`)
- Command palette with every action (`⌘K`), find topic (`⌘F`), map switcher (`⌘P`)
- Paste any outline or indented text as topics. Copy a branch as Markdown
- Drag and drop to rearrange
- Full undo and redo
- Export to Markdown, OPML, SVG and PNG. Import from Markdown, OPML and plain text
- Light and dark themes (follows the system)
- Picks up edits made in another app (for example Obsidian) when you switch back

## Keyboard

`⌘` is `Ctrl` on Windows and Linux. Press `?` in the app for the full list.

| Topic selected | |
|---|---|
| `Tab` | New child topic |
| `Enter` / `Shift+Enter` | New topic below / above |
| Any letter, `Space`, `F2` | Start typing (a letter replaces the text) |
| Arrow keys | Move selection |
| `⌥` + arrows | Move topic up/down, in/out |
| `⌫` | Delete topic |
| `⌘.` | Fold / unfold |
| `⌘Enter` | Toggle checkbox |
| `⌥1`–`⌥9` / `⌥0` | Set colour / automatic. `⌘⇧C` opens the colour picker |
| `⌘E` | Notes |
| `⌘]` / `⌘[` | Focus in / out |
| `⌘C` `⌘X` `⌘V` `⌘D` | Copy, cut, paste, duplicate branch |

| Typing in a topic | |
|---|---|
| `Enter` | Next topic. On an empty topic: step out a level, or stop |
| `Tab` / `Shift+Tab` | Indent / outdent |
| `Shift+Enter` | Line break |
| `⌫` on an empty topic | Delete it and go back to the previous topic |
| `Esc` | Stop typing |

| Anywhere | |
|---|---|
| `⌘K` | Command palette |
| `⌘F` | Find topic |
| `⌘N` / `⌘P` | New map / open map |
| `⌘1` / `⌘2` | Map / outline view |
| `⌘L` | Switch layout |
| `⌘0` `⌘=` `⌘-` | Fit, zoom in, zoom out |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘B` | Toggle sidebar |

## File format

```markdown
# Algorithms — Lecture 3
> Prof. Smith, room 204

- Quicksort
  > Pivot choice matters.
  - [ ] review partition
  - [x] average O(n log n)
- Merge sort <!--collapsed-->
  - stable
```

- `# heading` is the central topic. The file name follows it.
- Nested `-` items are topics, two spaces per level.
- `>` lines under an item are that topic's notes (Markdown).
- `[ ]` / `[x]` makes a checkbox topic.
- `<!--color:blue-->` or `<!--color:#0b7285-->` sets a topic colour. Hidden in Obsidian's reading view.
- `<!--collapsed-->` remembers a folded branch. Obsidian hides it in reading view.
- YAML front matter is kept as it is.

Import is more lenient. It also accepts `##` headings, `*`/`+`/`1.` bullets, tabs and plain paragraphs, so most existing Markdown notes open as a sensible map.

## Build from source

You need [Node.js 20+](https://nodejs.org/) and [Rust](https://rustup.rs/).

- **macOS:** `xcode-select --install`
- **Linux:** the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (webkit2gtk 4.1 and others)
- **Windows:** Microsoft C++ Build Tools and WebView2 (preinstalled on Windows 11)

```bash
npm install
npm run tauri dev      # desktop app with hot reload
npm run tauri build    # installers in src-tauri/target/release/bundle/
npm test               # parser and model tests
```

To work on the UI without Rust, run `npm run dev` and open http://localhost:1420. In a plain browser, maps are kept in localStorage.

## Project layout

```
src/
  model.ts      tree data, structural operations, undo history
  markdown.ts   Markdown <-> tree (the file format)
  opml.ts       OPML import/export
  layout.ts     tree layout (mind map / right tree)
  mapview.ts    map rendering, camera, mouse, inline editing
  outline.ts    outline view
  app.ts        state, commands, keyboard, saving
  palette.ts    command palette
  exporter.ts   SVG / PNG export
  storage.ts    folder storage (desktop) / localStorage (browser)
src-tauri/      Rust shell: read/write/rename/trash commands
tests/          Vitest tests
scripts/        release helpers (Homebrew cask)
```

There's no UI framework, just TypeScript and DOM. Every keyboard action is a command in `app.ts → buildCommands()`, so a new command shows up in the palette and the help screen automatically. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- [ ] Cross-links between topics
- [ ] Present mode (step through branches)
- [ ] Images and attachments in notes
- [ ] Rendered Markdown preview for notes
- [ ] More layouts (down tree, org chart)
- [ ] winget (Windows) and Flathub (Linux) packages
- [ ] Signed and notarized macOS build
- [ ] iPad / mobile

## Maintainers: releasing

1. Bump `version` in `package.json` and `src-tauri/tauri.conf.json`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. GitHub Actions builds macOS (universal), Windows and Linux (x64 + arm64) and publishes the release.
4. The `homebrew` job updates `ALMAZY/homebrew-tap` when the repo has a `TAP_TOKEN` secret: a fine-grained token with **Contents: read and write** on `homebrew-tap` only. Without it, run `scripts/update-cask.sh vX.Y.Z` yourself.

## License

MIT © 2026 Aleksandrs Mazurs
