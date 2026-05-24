# Zotero Author Browser

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero Author Browser 用于在 Zotero 文库中浏览作者（creator）、查看作者覆盖情况、管理作者别名，并支持跳转到外部作者检索页面。

[English](README.md) | [简体中文](README-zhCN.md)

## 当前状态

插件仍在持续开发中，目前主要聚焦 Zotero 中的作者清理工作流：作者浏览、别名管理、外部检索和批量合并复核。

## 使用方法

### 1）先看覆盖情况，再打开对应条目

1. 打开 Author Browser，先按条目数排序，优先处理高频作者名。
2. 双击作者行（或在 Zotero 右侧作者区域使用右键菜单）即可打开该作者的全部条目。
3. 如果该作者有别名，结果会自动联动主作者和全部别名作者。

### 2）从 Zotero 直接跳转外部作者检索

1. 在 Zotero 作者区域或 Author Browser 中选中作者。
2. 使用底部按钮或行右键菜单中的 `Search Scholar` / `Search CNKI`。
3. 若存在别名关系，插件会先解析到主作者再发起检索。
4. 姓名格式会按语言场景自动处理：
   - 中日韩姓名使用 `姓+名`（无空格），例如 `张三`。
   - 非中日韩姓名使用 `名 空格 姓`。

### 3）按作者逐个清理别名

1. 在 Author Browser 选中一位作者，点击 `Aliases` 打开别名管理器。
2. 在 `当前别名` 和 `建议别名` 两列之间对照确认。
3. 根据需要执行常用操作：
   - `添加选中的建议别名`
   - `添加全部建议别名`
   - `添加作者浏览器选中作者`
   - `将选中的别名恢复为主条目`
   - `刷新`
4. 可以同时打开多个别名管理器窗口，分别处理不同作者。
5. 对同一作者重复打开时，会自动聚焦到已经打开的窗口。

### 4）一次性检查并合并全部作者

1. 在 Author Browser 点击 `Check & Merge All`。
2. 先确认预检查弹窗，其中会显示两类候选分组数量：
   - 第一阶段：规范化全名完全一致（自动合并）。
   - 第二阶段：同姓 + 名字首字母（人工决策）。
3. 第二阶段可按组选择 `Yes`、`No`，也可以用 `All Yes` / `All No` 一次应用到剩余分组。
4. 底部状态消息会实时显示执行中、取消或最终汇总结果。
5. 执行完成后，Author Browser 和已打开的别名管理器会自动刷新。

### 5）查看最近一次批量合并明细

1. 在 Author Browser 点击 `Merge Details`。
2. 在明细窗口查看汇总指标（`Added`、`Merged Groups`、`Skipped`、`Blocked`）和每组处理决策。
3. 可将该窗口作为本轮批量处理后的复核记录，再决定是否进行手工调整。

## 匹配与合并规则

- 别名关系采用单层结构：`mainID -> aliasIDs[]`。
- 别名建议与批量合并共用同一套匹配逻辑：
  - 规范化全名匹配。
  - 同姓 + 名字首字母匹配。
- 若待添加作者本身已拥有别名组，添加时可在确认后进行“整组合并”。
- `将选中的别名恢复为主条目` 当前只会把所选别名恢复为独立主条目。

## 开发

```bash
npm install
npm run start
```

构建：

```bash
npm run build
```
