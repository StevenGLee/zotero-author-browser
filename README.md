# Zotero Author Browser

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero Author Browser helps you browse creators, inspect author coverage, manage author aliases, and jump to external author search pages.

[English](README.md) | [Simplified Chinese](README-zhCN.md)

## Current Status

The plugin is actively developed and currently focuses on daily author-cleanup workflows in Zotero: browsing creators, managing aliases, external author lookup, and batch merge review.

## Feature Overview

### 1) Author browsing and coverage inspection

1. Browse all creators in Author Browser with author ID, first name, last name, item count, and aliases.
2. Sort by item count to prioritize high-impact cleanup targets.
3. Double-click a row (or use the creator-pane context action) to open related items.

### 2) Alias-aware author item opening

1. Open all items for a selected author directly from Author Browser.
2. If aliases exist, results include the main author and linked aliases.

### 3) External author search from Zotero

1. Search selected authors in Google Scholar or CNKI from footer buttons or row context menu.
2. Lookup is alias-aware and resolves to the main author first when aliases exist.
3. Name formatting is locale-aware:
   - CJK names use `lastName+firstName` (no space).
   - Non-CJK names use `firstName lastName`.

### 4) Alias Manager for focused cleanup

1. Open Alias Manager for one selected author.
2. Compare `Current Aliases` and `Suggested Aliases`.
3. Use built-in actions to add, restore, refresh, and merge alias groups safely.
4. Keep multiple Alias Manager windows open for parallel review.

### 5) Auto-check and merge author aliases (new)

1. Start from either entry:
   - `Tools -> Auto Merge Author Aliases` (headless, no Author Browser window needed).
   - `Author Browser -> Check & Merge All`.
2. Confirm one precheck dialog that reports planned units:
   - Stage 1A: normalized full-name auto-merge groups.
   - Stage 1B: high-confidence abbreviation auto-merge groups.
   - Stage 2B: manual confirmation pairs.
   - Stage 2A: ambiguous abbreviation review groups.
3. Execution order is fixed: `1A -> 1B -> 2B -> 2A`.
4. Stage 2B uses native confirmation (`Yes / No` with apply-all and skip-rest behavior).
5. Stage 2A uses a dedicated ambiguous window with item previews on both sides:
   - Merge to the selected candidate.
   - Skip current group.
   - Skip all remaining ambiguous groups.
6. After completion, Author Browser data and opened Alias Manager windows are refreshed automatically.

### 6) Latest run audit details

1. In Author Browser, click `Merge Details`.
2. Review summary metrics and per-group decisions.
3. Use this as a post-run audit trail before additional manual cleanup.

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

1. You can run it in two ways:
   - `Tools -> Auto Merge Author Aliases` (runs directly without opening Author Browser).
   - In Author Browser, click `Check & Merge All`.
2. Confirm the precheck dialog, which reports planned counts for 1A/1B/2B/2A.
3. The merge runs in this order:
   - Stage 1A: normalized full-name auto-merge.
   - Stage 1B: high-confidence abbreviation auto-merge.
   - Stage 2B: manual confirmation for remaining non-ambiguous pairs.
   - Stage 2A: ambiguous abbreviation review in a dedicated window.
4. In Stage 2B, use `Yes`, `No`, apply-to-all, or skip-rest.
5. In Stage 2A, compare both sides' item lists and choose one candidate, skip current, or skip remaining ambiguous groups.
6. Watch the footer status message (Author Browser mode) or prompt summary (Tools mode) for completion/cancellation results.
7. After completion, Author Browser data and opened Alias Manager windows are refreshed.

### 5) Review the latest batch merge result

1. Click `Merge Details` in Author Browser.
2. Read the summary metrics (`Added`, `Merged Groups`, `Skipped`, `Blocked`) and per-group decisions.
3. Use this dialog as your post-run audit trail before doing additional manual cleanup.

## Matching and Merge Behavior

- Alias links use a single-layer model: `mainID -> aliasIDs[]`.
- Name matching logic is shared across alias suggestion and batch merge:
  - Normalized full-name match.
  - High-confidence abbreviation match.
  - Same last name + first-name initial (manual confirmation).
- Ambiguous abbreviation cases (one abbreviation mapping to multiple full-name candidates) are handled in a dedicated review window instead of auto-merging.
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
