# Zotero Author Browser

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero Author Browser 用于在 Zotero 文库中浏览作者（creator）、查看作者覆盖情况、管理作者别名，并支持跳转到外部作者检索页面。

[English](README.md) | [简体中文](README-zhCN.md)

## 当前状态

插件仍在持续开发中，当前已支持可用的 **Alias Manager（别名管理器）**，以及对 **Google Scholar** 和 **CNKI** 的作者检索入口。

## 已实现功能

- **显示该作者的全部条目（Show All Items with This Creator）**
  - 已加入 Zotero 右侧作者区域的右键菜单。
  - 在 Author Browser 中双击作者行也可触发。
  - 支持别名联动：若作者存在别名，会同时检索主作者及其全部别名作者的条目。
- **外部作者检索**
  - **在 Google Scholar 中搜索作者**
    - 可从主界面作者右键菜单触发。
    - 可从 Author Browser（`allAuthorWindow`）底部按钮和行右键菜单触发。
  - **在 CNKI 中搜索作者**
    - 可从主界面作者右键菜单触发。
    - 可从 Author Browser（`allAuthorWindow`）底部按钮和行右键菜单触发。
  - 支持别名联动：若存在别名关系，外部检索会先解析到主作者。
  - 支持中日韩姓名格式处理：
    - 中日韩姓名按 `姓+名`（无空格）检索，例如 `张三`。
    - 非中日韩姓名按 `名 空格 姓` 检索。
- **作者浏览器（Author Browser）**
  - 按作者列出条目计数。
  - 支持排序、重命名、名姓互换、大小写修正。
  - 在别名列显示当前主作者关联的别名。
  - 统计时会将别名作者的条目数合并到主作者行。
- **别名管理器（Alias Manager）**
  - 在作者浏览器中选中作者后，点击 `Aliases` 打开该作者的别名管理器。
  - 窗口中并排显示 `当前别名` 与 `建议别名`，便于对比和处理。
  - 常用操作包括：
    - `添加选中的建议别名`
    - `添加全部建议别名`
    - `添加作者浏览器选中作者`
    - `将选中的别名恢复为主条目`
    - `刷新`
  - 可同时打开多个别名管理器窗口，分别处理不同作者。
  - 对同一作者重复打开时，会自动聚焦到已打开的窗口。
  - 添加或恢复后，窗口内会直接显示最新别名结果。

## 别名规则

- 使用单层结构：`mainID -> aliasIDs[]`。
- 建议别名匹配规则：
  - 规范化全名匹配。
  - 同姓 + 名字首字母匹配。
- 当添加的作者本身已拥有别名组时，支持“整组合并”，并在执行前弹出确认。
- `将选中的别名恢复为主条目` 当前仅恢复所选 alias 为独立主条目。

## 开发

```bash
npm install
npm run start
```

构建：

```bash
npm run build
```
