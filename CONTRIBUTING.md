# Contributing to Ramify

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Principles

1. **Keyboard first.** Every feature must work without a mouse, and the mouse is a nice extra. A new action is a command in `buildCommands()` (`src/app.ts`), so it appears in the palette and the help screen.
2. **Plain files.** The `.md` format must stay readable and editable by hand, and keep working in Obsidian. Don't add hidden metadata unless you can't avoid it.
3. **Small and fast.** No UI framework, and as few dependencies as possible. The map must stay smooth at a few thousand topics.

## Getting started

```bash
npm install
npm run dev          # browser only, quickest for UI work
npm run tauri dev    # full desktop app
npm test
```

## Pull requests

- Keep one change per PR, and describe what you changed and why.
- If you touch `src/markdown.ts` or `src/model.ts`, add or update a test in `tests/`. A round-trip (parse → serialize → same text) must not change a file.
- Run `npm test` and `npm run build` before you push. CI runs both.
- For UI changes, add a screenshot or a short GIF to the PR.

## Reporting bugs

Open an issue with your OS, the Ramify version, the steps to reproduce, and if you can, the `.md` file (or a small part of it) that shows the problem.
