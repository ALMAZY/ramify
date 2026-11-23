# Changelog

All notable changes to Ramify. The section for each version is shown in the
release notes and in the in-app update banner.

## [0.3.1] — 2026-11-23

### Fixed
- **Backspace in a text field of the style panel or the Gantt table (assignee, dates, days) deleted topics on the map.** Fields now keep their keys; Esc returns to the map.
- Deleting a topic with sub-topics now says how many went, and that ⌘Z brings them back.
- Graphite theme: topic colours now match their names (orange was shown blue).
- Outline view: note previews show plain text instead of Markdown marks.
- Release builds stay hidden until every platform is ready, so "Check for updates" never fails half-way through a release.

## [0.3.0] — 2026-11-23

### New
- Task details on any topic (⌘⇧K): progress, priority P1–P5, start and due dates, duration, assignee, and the tasks it waits for. The topic shows a priority badge, a progress bar, the dates and the assignee.
- Gantt chart (⌘3, or the chart button in the toolbar). Drag a bar to move it, its ends to change the dates, the knob under it to set progress; tasks that come after it move along. Shift-click tasks and press Dependencies to chain them in that order. Export as PNG, JPEG, PDF, Excel (CSV) or Calendar (.ics), or print.
- Summary: a brace over several topics with a summary topic beside them (⌘⇧]). Shift-click to pick the topics.
- Boundary: a dashed box with a label around a branch (⌘⇧B).
- Labels under a topic, for roles or owners (⌘⇧;).
- Text on links ("Text on link…") and links to a topic in another map.
- Two new layouts, Timeline and Brace map, and a line style choice: curved, elbow or straight. The org chart now uses straight elbow lines.
- Notes: Enter continues a list (`- [ ]` tasks, bullets, numbered lists); Tab and Shift+Tab indent.

### Fixed
- The Settings menu opened below the bottom of the window. It now opens above the button.

## [0.2.2] — 2026-11-23

### New
- ⌘E opens a topic's notes over the whole right panel. ⌘E again, Esc or ‹ goes back.

## [0.2.1] — 2026-11-23

### New
- Delete, rename or open a map from the sidebar: right-click it or use the ⋯ button.

### Fixed
- The map stays sharp at every zoom level (it used to get blurry when zoomed in).
- Cloud shape is no longer cut off at the edges, in the shape picker and on topics.
- The style panel's Layout and Topic style buttons now show the current choice when you change it with a shortcut or command.
- macOS app icon now fills the standard icon shape instead of sitting small on a grey tile (macOS 26).

## [0.2.0] — 2026-11-23

### New
- New look: filled topics, a style panel on the right, toolbar, zoom bar and a sidebar with search.
- 15 topic shapes, 12 colours plus any custom colour, icons, and "Children too" to style a whole branch.
- Callouts, web links and tasks from the style panel.
- Cross-links find their own way around topics and never share a line or an arrowhead.
- In-app updates: Ramify tells you when a new version is out and installs it in one click.
- Rich notes, attachments, daily notes, search across all maps, folders, present mode, AI Assist, 16 themes and 4 layouts.
- Import from XMind and FreeMind; export to PDF, HTML, JSON and plain text.

### Fixed
- Selection ring follows the topic's shape.
- Undo no longer brings back an empty topic that was removed.
- Readable text on light colours in dark themes.

## [0.1.0] — 2026-11-21

First release: keyboard-first mind map, outline view, notes, Markdown files, export and import.
