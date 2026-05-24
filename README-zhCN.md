# Zotero Author Browser

[![zotero target version](https://img.shields.io/badge/Zotero-9%20to%2010--beta-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero Author Browser 用于在 Zotero 文库中浏览作者（creator）、查看作者覆盖情况、管理作者别名，并支持跳转到外部作者检索页面。

[English](README.md) | [简体中文](README-zhCN.md)

## 当前状态

插件仍在持续开发中，目前主要聚焦 Zotero 中的作者清理工作流：作者浏览、别名管理、外部检索和批量合并复核。
当前 manifest 兼容目标：Zotero 9.x 到 10.x beta（`strict_max_version: 10.*`）。

## 功能介绍

### 1）作者浏览与覆盖检查

1. 在 Author Browser 中查看全部作者：作者 ID、名、姓、条目数、别名。
2. 支持按条目数排序，优先处理高频作者名。
3. 双击作者行（或在 Zotero 作者区右键）即可打开对应条目。

### 2）别名联动的作者条目查看

1. 可直接打开某位作者的全部相关条目。
2. 若该作者存在别名，结果会自动联动主作者与全部别名作者。

### 3）从 Zotero 直接进行外部作者检索

1. 可在底部按钮或作者行右键菜单中使用 `Search Scholar` / `Search CNKI`。
2. 检索前会先按别名关系解析到主作者，再发起搜索。
3. 姓名格式按语言场景自动处理：
   - 中日韩姓名使用 `姓+名`（无空格）。
   - 非中日韩姓名使用 `名 空格 姓`。

### 4）按作者精细清理别名（Alias Manager）

1. 选中作者后打开 `Aliases`，进入 Alias Manager。
2. 对照 `Current Aliases` 与 `Suggested Aliases`。
3. 支持添加、恢复、刷新、整组合并等操作。
4. 可同时打开多个 Alias Manager 窗口并行处理不同作者。

### 5）自动检查作者别名并合并（新增）

1. 支持两个入口：
   - `工具 -> 自动检查并合并作者别名`（可直接执行，无需打开作者浏览器）。
   - `Author Browser -> 检查并合并全部作者`。
2. 执行前先弹一次预检查确认，显示四类待处理数量：
   - 第 1A 阶段：规范化全名自动合并分组。
   - 第 1B 阶段：高置信缩写自动合并分组。
   - 第 2B 阶段：其余人工确认对。
   - 第 2A 阶段：缩写歧义判断分组。
3. 执行顺序固定为：`1A -> 1B -> 2B -> 2A`。
4. 第 2B 阶段使用原生确认框：可逐对 `是/否`，也可应用到后续或后续全部暂不合并。
5. 第 2A 阶段使用歧义专窗：对比双方论文列表后，选择合并目标、跳过当前，或跳过剩余歧义分组。
6. 完成后会自动刷新 Author Browser 与已打开的 Alias Manager 窗口。

### 6）查看最近一次批量合并详情

1. 在 Author Browser 点击 `合并详情`。
2. 查看汇总统计（Added / Merged Groups / Skipped / Blocked）和逐组决策记录。
3. 可作为本次批量执行后的审计记录，再决定是否进行人工微调。

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
2. 在 `Current Aliases` 和 `Suggested Aliases` 两列之间对照确认。
3. 根据需要执行常用操作：
   - `Add Selected Suggestions`
   - `Add All Suggestions`
   - `Add Author Browser Selection`
   - `Restore Selected Aliases`
   - `Refresh`
4. 可以同时打开多个别名管理器窗口，分别处理不同作者。
5. 对同一作者重复打开时，会自动聚焦到已经打开的窗口。

### 4）自动检查并合并全部作者别名

1. 你可以通过两个入口执行：
   - `工具 -> 自动检查并合并作者别名`（不打开作者浏览器，直接执行）。
   - 在 Author Browser 点击 `检查并合并全部作者`。
2. 预检查确认框会显示 1A/1B/2B/2A 四类计划数量。
3. 流程按 `1A -> 1B -> 2B -> 2A` 执行：
   - 1A：规范化全名自动合并；
   - 1B：高置信缩写自动合并；
   - 2B：剩余非歧义对人工确认；
   - 2A：缩写歧义分组专窗判断。
4. 第 2B 阶段可选 `是/否`，也可应用到后续，或后续全部暂不合并。
5. 第 2A 阶段可在歧义窗口对比论文列表后，选择合并、跳过当前或跳过后续歧义分组。
6. Author Browser 模式下可在底部状态栏查看进度；工具菜单模式下会收到汇总提示框。
7. 执行结束后，Author Browser 和已打开的 Alias Manager 会自动刷新。

### 5）查看最近一次批量合并明细

1. 在 Author Browser 点击 `合并详情`。
2. 在明细窗口查看汇总指标（`Added`、`Merged Groups`、`Skipped`、`Blocked`）和每组处理决策。
3. 可将该窗口作为本轮批量处理后的复核记录，再决定是否进行手工调整。

## 匹配与合并规则

- 别名关系采用单层结构：`mainID -> aliasIDs[]`。
- 别名建议与批量合并共用同一套匹配逻辑：
  - 规范化全名匹配；
  - 高置信缩写匹配；
  - 同姓 + 名字首字母匹配（人工确认）。
- 对“一个缩写可对应多个全名候选”的歧义场景，不会自动合并，而是进入专门的歧义判断窗口。
- 若待添加作者本身已拥有别名组，添加时可在确认后执行“整组合并”。
- `Restore Selected Aliases` 当前只会把所选别名恢复为独立主条目。

## 开发

```bash
npm install
npm run start
```

构建：

```bash
npm run build
```
