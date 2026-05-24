# Zotero Author Browser

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero Author Browser helps you browse creators, inspect author coverage, manage author aliases, and jump to external author search pages.

[English](README.md) | [Simplified Chinese](README-zhCN.md)

## Current Status

The plugin is actively developed and currently focuses on daily author-cleanup workflows in Zotero: browsing creators, managing aliases, external author lookup, and batch merge review.

## Usage Guide

### 1) Review coverage and open related items

1. Open Author Browser and sort by item count to find heavily used author names first.
2. Double-click a row (or use the context entry in Zotero's creator pane) to open all items for that author.
3. If the author has aliases, results are alias-aware and include the main author plus all linked aliases.

### 2) Search an author outside Zotero

1. Select an author in Zotero creator pane or in Author Browser.
2. Use `Search Scholar` or `Search CNKI` from the footer button or row right-click menu.
3. The lookup is alias-aware: if aliases exist, the plugin resolves to the main author first.
4. Name formatting is locale-aware:
   - CJK names use `lastName+firstName` (no space), for example `张三`.
   - Non-CJK names use `firstName lastName`.

### 3) Clean one author with Alias Manager

1. In Author Browser, select one row and click `Aliases`.
2. Compare `Current Aliases` and `Suggested Aliases` side by side.
3. Apply the action that matches your intent:
   - `Add Selected Suggestions`
   - `Add All Suggestions`
   - `Add Author Browser Selection`
   - `Restore Selected Aliases`
   - `Refresh`
4. You can keep multiple Alias Manager windows open for different authors.
5. Opening Alias Manager again for the same author focuses the existing window.

### 4) Batch-check and merge all authors

1. In Author Browser, click `Check & Merge All`.
2. Confirm the precheck dialog, which reports two candidate counts:
   - Stage 1: normalized full-name exact matches (auto-merge).
   - Stage 2: same last name + first-name initial matches (manual decision).
3. For Stage 2 groups, choose `Yes`, `No`, or use apply-all choices (`All Yes` / `All No`).
4. Watch the status message in the footer for progress, cancellation, or final summary.
5. After completion, Author Browser data and opened Alias Manager windows are refreshed.

### 5) Review the latest batch merge result

1. Click `Merge Details` in Author Browser.
2. Read the summary metrics (`Added`, `Merged Groups`, `Skipped`, `Blocked`) and per-group decisions.
3. Use this dialog as your post-run audit trail before doing additional manual cleanup.

## Matching and Merge Behavior

- Alias links use a single-layer model: `mainID -> aliasIDs[]`.
- Name matching logic is shared across alias suggestion and batch merge:
  - Normalized full-name match.
  - Same last name + first-name initial.
- If a selected author already owns an alias group, adding it can trigger group merge after confirmation.
- `Restore Selected Aliases` restores only the selected aliases as independent main entries.

## Development

```bash
npm install
npm run start
```

Build:

```bash
npm run build
```
