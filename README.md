# Zotero Author Browser

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero Author Browser helps you browse creators, inspect author coverage, manage author aliases, and jump to external author search pages.

[English](README.md) | [Simplified Chinese](README-zhCN.md)

## Current Status

The plugin is actively developed and now supports a working **Alias Manager** plus external author search in **Google Scholar** and **CNKI**.

## Implemented Features

- **Show All Items with This Creator**
  - Added to the creator context menu in Zotero's right sidebar.
  - Also available from Author Browser row activation.
  - Alias-aware: when a creator is aliased, results include the main author and all aliases.
- **External Author Search**
  - **Search in Google Scholar**
    - Available in the creator context menu (right sidebar).
    - Available in Author Browser (`allAuthorWindow`) via footer button and row right-click menu.
  - **Search in CNKI**
    - Available in the creator context menu (right sidebar).
    - Available in Author Browser (`allAuthorWindow`) via footer button and row right-click menu.
  - Alias-aware: external searches resolve to the main author when aliases exist.
  - CJK-aware name formatting for external searches.
    - CJK names use `lastName+firstName` (no space), e.g. `张三`.
    - Non-CJK names use `firstName lastName`.
- **Author Browser**
  - Lists creators with item counts.
  - Supports sort, rename, swap first/last name, and capitalization fix.
  - Shows alias names in the alias column.
  - Merges item counts from aliases into the main author row.
- **Alias Manager**
  - Select an author in Author Browser, then click `Aliases` to open Alias Manager for that person.
  - You can review `Current Aliases` and `Suggested Aliases` side by side.
  - Common actions for daily use:
    - `Add Selected Suggestions`
    - `Add All Suggestions`
    - `Add Author Browser Selection`
    - `Restore Selected Aliases`
    - `Refresh`
  - You can keep multiple Alias Manager windows open for different authors.
  - Reopening Alias Manager for the same author will focus the existing window.
  - After add/restore actions, the latest alias list is shown directly in the manager.

## Alias Rules

- Uses a single-layer model: `mainID -> aliasIDs[]`.
- Candidate suggestions are based on:
  - Normalized full-name match.
  - Same last name and first-name initial.
- When adding an author that already owns an alias group, group merge is supported with confirmation.
- Restoring aliases currently restores only the selected alias entries as independent main entries.

## Development

```bash
npm install
npm run start
```

Build:

```bash
npm run build
```
