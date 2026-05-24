/// @ts-nocheck
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { isWindowAlive } from "../utils/window";
import {
  applyAliasMutation,
  CreatorStatDataRow,
  expandGroupForMerge,
  getAllCreatorStats,
  getAllCreators,
  hasAliasGroup,
  resolveMainID,
  searchAuthorInGoogleScholarByID,
  searchAuthorInCNKIByID,
  showAuthorByID,
} from "./authorBrowserAddon";
import {
  onDialog as onAliasEditorDialog,
  refreshAllOpenAliasManagers,
} from "./aliasEditor";
import {
  getCreatorNameMatchType,
  getNormalizedFullName,
} from "./authorNameMatch";

type BulkMergePhase = "phase1-normalized" | "phase2-initial";
type BulkMergeDecision =
  | "auto"
  | "yes"
  | "no"
  | "all-yes"
  | "all-no"
  | "skipped";

interface BulkMergeGroupPlan {
  phase: BulkMergePhase;
  targetMainID: number;
  candidateMainIDs: number[];
}

interface BulkMergeDetailEntry {
  phase: BulkMergePhase;
  targetMainID: number;
  targetMainName: string;
  candidateMainIDs: number[];
  candidateMainNames: string[];
  decision: BulkMergeDecision;
  addedAliasCount: number;
  mergedGroupCount: number;
  skippedCount: number;
  conflictCount: number;
}

interface BulkMergeReport {
  startedAt: number;
  finishedAt: number;
  cancelled: boolean;
  phase1GroupCount: number;
  phase2GroupCount: number;
  addedAliasCount: number;
  mergedGroupCount: number;
  skippedCount: number;
  conflictCount: number;
  entries: BulkMergeDetailEntry[];
}

interface MainAuthorRecord {
  mainID: number;
  firstName: string;
  lastName: string;
  normalizedFullName: string;
  itemCount: number;
  hasAliasGroup: boolean;
}

let bulkMergeRunning = false;
let latestBulkMergeReport: BulkMergeReport | undefined = undefined;
let bulkMergeStatusMessage = "";

function createCompatDeferred() {
  let pending = true;
  let resolveFn: (value?: any) => void = () => {};
  let rejectFn: (reason?: any) => void = () => {};
  const promise: any = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  promise.isPending = () => pending;
  return {
    promise,
    resolve(value?: any) {
      if (!pending) {
        return;
      }
      pending = false;
      resolveFn(value);
    },
    reject(reason?: any) {
      if (!pending) {
        return;
      }
      pending = false;
      rejectFn(reason);
    },
  };
}

function createDialogDataWithCompatLocks(
  baseData: { [key: string | number]: any } = {},
) {
  return {
    ...baseData,
    loadLock: createCompatDeferred(),
    unloadLock: createCompatDeferred(),
  };
}

export async function onDialog() {
  if (isWindowAlive(addon.data.manager.window)) {
    addon.data.manager.window?.focus();
    await refresh();
  } else {
    const windowArgs = {
      _initPromise: Zotero.Promise.defer(),
    };
    const win = Zotero.getMainWindow().openDialog(
      `chrome://${config.addonRef}/content/AllAuthorsWindow.xhtml`,
      `${config.addonRef}-allAuthorWindow`,
      `chrome,centerscreen,resizable,status,dialog=no`,
      windowArgs,
    )!;
    await windowArgs._initPromise.promise;
    addon.data.manager.window = win;
    addon.data.manager.tableHelper = new ztoolkit.VirtualizedTable(win!)
      .setContainerId("table-container")
      .setProp({
        id: "author-list",
        columns: [
          {
            dataKey: "creatorID",
            label: "creatorID",
            fixedWidth: false,
          },
          {
            dataKey: "firstName",
            label: "firstName",
            fixedWidth: false,
          },
          {
            dataKey: "lastName",
            label: "lastName",
            fixedWidth: false,
          },
          {
            dataKey: "itemCount",
            label: "itemCount",
            fixedWidth: false,
          },
          {
            dataKey: "aliasFullNames",
            label: "aliasFullNames",
            fixedWidth: false,
          },
        ].map((column) =>
          Object.assign(column, {
            label: getString(column.label),
          }),
        ),
        showHeader: true,
        multiSelect: false,
        staticColumns: false,
        disableFontSizeScaling: true,
      })
      .setProp("getRowCount", () => addon.data.manager.data.length)
      .setProp("getRowData", (index) => ({
        creatorID: String(addon.data.manager.data[index].creatorID),
        firstName: addon.data.manager.data[index].firstName,
        lastName: addon.data.manager.data[index].lastName,
        itemCount: String(addon.data.manager.data[index].itemCount),
        aliasFullNames: addon.data.manager.data[index].aliasFullNamesString,
      }))
      .setProp("onSelectionChange", () => {
        updateButtons();
      })
      .setProp("onActivate", () => {
        showAuthorByID(getSelectedNoteIds());
        return true;
      })
      .setProp("onColumnSort", (columnIndex, ascending) => {
        addon.data.manager.columnIndex = columnIndex;
        addon.data.manager.columnAscending = ascending > 0;
        quickSort();
      })
      .setProp("onItemContextMenu", (ev, x, y) => {
        showAuthorListContextMenu(ev, x, y);
        return true;
      })
      .render();

    const refreshButton = win.document.querySelector(
      "#refresh",
    ) as HTMLButtonElement;
    const renameButton = win.document.querySelector(
      "#rename",
    ) as HTMLButtonElement;
    const aliasButton = win.document.querySelector(
      "#alias",
    ) as HTMLButtonElement;
    const bulkMergeButton = win.document.querySelector(
      "#bulk-merge",
    ) as HTMLButtonElement;
    const bulkMergeDetailsButton = win.document.querySelector(
      "#bulk-merge-details",
    ) as HTMLButtonElement;
    const swapButton = win.document.querySelector("#swap") as HTMLButtonElement;
    const fixCapssButton = win.document.querySelector(
      "#fix-caps",
    ) as HTMLButtonElement;
    const showItemsButton = win.document.querySelector(
      "#show-item",
    ) as HTMLButtonElement;
    const searchScholarButton = win.document.querySelector(
      "#search-scholar",
    ) as HTMLButtonElement;
    const searchCNKIButton = win.document.querySelector(
      "#search-cnki",
    ) as HTMLButtonElement;
    const searchScholarContextMenuItem = win.document.querySelector(
      "#search-scholar-context",
    ) as XUL.MenuItem;
    const searchCNKIContextMenuItem = win.document.querySelector(
      "#search-cnki-context",
    ) as XUL.MenuItem;

    refreshButton.addEventListener("click", () => {
      refresh();
    });
    renameButton.addEventListener("click", async () => {
      const creatorID = getSelectedNoteIds();
      if (creatorID <= 0) {
        return;
      }
      await remnameDialog(creatorID);
      refresh();
    });
    aliasButton.addEventListener("click", async () => {
      await openAliasManagerForSelection();
    });
    bulkMergeButton?.addEventListener("click", async () => {
      await runBatchMergeAllAuthors();
    });
    bulkMergeDetailsButton?.addEventListener("click", () => {
      showLatestBatchMergeDetails();
    });
    swapButton.addEventListener("click", async () => {
      const creatorID = getSelectedNoteIds();
      await swapNames(creatorID);
      await refresh();
    });
    fixCapssButton.addEventListener("click", async () => {
      await capitalizeCreatorName();
    });
    showItemsButton.addEventListener("click", () => {
      const creatorID = getSelectedNoteIds();
      if (creatorID > 0) {
        showAuthorByID(creatorID);
      }
    });
    searchScholarButton.addEventListener("click", () => {
      openScholarForSelection();
    });
    searchCNKIButton.addEventListener("click", () => {
      openCNKIForSelection();
    });
    searchScholarContextMenuItem?.addEventListener("command", () => {
      openScholarForSelection();
    });
    searchCNKIContextMenuItem?.addEventListener("command", () => {
      openCNKIForSelection();
    });

    setBatchMergeStatusMessage(bulkMergeStatusMessage);
    await refresh();
  }
}

const sortDataKeys = ["creatorID", "firstName", "lastName", "itemCount"];

async function quickSort() {
  const sortKey = sortDataKeys[addon.data.manager.columnIndex];
  addon.data.manager.data.sort((a, b) => {
    if (!a || !b) {
      return 0;
    }
    if (sortKey == "itemCount" || sortKey == "creatorID") {
      const valueA = Number(a[sortKey] || 0);
      const valueB = Number(b[sortKey] || 0);
      return addon.data.manager.columnAscending
        ? valueA - valueB
        : valueB - valueA;
    } else {
      const valueA = String(a[sortKey] || "");
      const valueB = String(b[sortKey] || "");
      return addon.data.manager.columnAscending
        ? valueA.localeCompare(valueB)
        : valueB.localeCompare(valueA);
    }
  });
  await updateTable();
  updateButtons();
}

async function updateData() {
  const sortKey = sortDataKeys[addon.data.manager.columnIndex];
  addon.data.manager.data = await getAllCreators(
    sortKey,
    addon.data.manager.columnAscending == false,
  );
}

function updateButtons() {
  const win = addon.data.manager.window;
  if (!isWindowAlive(win)) {
    return;
  }
  const creatorID = getSelectedNoteIds();
  const fixCapssButton = win.document.querySelector(
    "#fix-caps",
  ) as HTMLButtonElement;
  const aliasButton = win.document.querySelector("#alias") as HTMLButtonElement;
  const bulkMergeButton = win.document.querySelector(
    "#bulk-merge",
  ) as HTMLButtonElement;
  const bulkMergeDetailsButton = win.document.querySelector(
    "#bulk-merge-details",
  ) as HTMLButtonElement;
  const renameButton = win.document.querySelector(
    "#rename",
  ) as HTMLButtonElement;
  const swapButton = win.document.querySelector("#swap") as HTMLButtonElement;
  const showItemsButton = win.document.querySelector(
    "#show-item",
  ) as HTMLButtonElement;
  const searchScholarButton = win.document.querySelector(
    "#search-scholar",
  ) as HTMLButtonElement;
  const searchCNKIButton = win.document.querySelector(
    "#search-cnki",
  ) as HTMLButtonElement;
  const searchScholarContextMenuItem = win.document.querySelector(
    "#search-scholar-context",
  ) as XUL.MenuItem;
  const searchCNKIContextMenuItem = win.document.querySelector(
    "#search-cnki-context",
  ) as XUL.MenuItem;

  renameButton.disabled = creatorID <= 0;
  aliasButton.disabled = creatorID <= 0;
  if (bulkMergeButton) {
    bulkMergeButton.disabled = bulkMergeRunning || addon.data.manager.data.length === 0;
  }
  if (bulkMergeDetailsButton) {
    bulkMergeDetailsButton.disabled = bulkMergeRunning || !latestBulkMergeReport;
  }
  swapButton.disabled = creatorID <= 0;
  showItemsButton.disabled = creatorID <= 0;
  searchScholarButton.disabled = creatorID <= 0;
  searchCNKIButton.disabled = creatorID <= 0;
  if (searchScholarContextMenuItem) {
    searchScholarContextMenuItem.disabled = creatorID <= 0;
  }
  if (searchCNKIContextMenuItem) {
    searchCNKIContextMenuItem.disabled = creatorID <= 0;
  }
  fixCapssButton.disabled =
    creatorID <= 0 || !canCapitalizeCreatorName(creatorID);

  setBatchMergeStatusMessage(bulkMergeStatusMessage);
}

async function updateTable() {
  return new Promise<void>((resolve) => {
    if (!addon.data.manager.tableHelper) {
      resolve();
      return;
    }
    addon.data.manager.tableHelper.render(undefined, () => {
      resolve();
    });
  });
}

async function refresh() {
  await updateData();
  await updateTable();
  updateButtons();
}

function getSelectedNoteIds() {
  const indices = getSelectedIndices(addon.data.manager.tableHelper);
  if (indices.length === 0) {
    return -1;
  }
  let id = -1;
  for (const idx of indices) {
    if (idx >= 0 && idx < addon.data.manager.data.length) {
      id = addon.data.manager.data[idx].creatorID;
    }
  }
  return id;
}

function getSelectedIndices(tableHelper: any): number[] {
  const selectedRaw = tableHelper?.treeInstance?.selection?.selected;
  if (!selectedRaw) {
    return [];
  }
  if (Array.isArray(selectedRaw)) {
    return selectedRaw
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0);
  }
  if (selectedRaw instanceof Set) {
    return Array.from(selectedRaw)
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0);
  }
  if (selectedRaw instanceof Map) {
    return Array.from(selectedRaw.keys())
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0);
  }
  if (typeof selectedRaw.values === "function") {
    const values = Array.from(selectedRaw.values());
    if (values.length > 0) {
      const parsed = values
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0);
      if (parsed.length > 0) {
        return parsed;
      }
    }
  }
  if (typeof selectedRaw.keys === "function") {
    return Array.from(selectedRaw.keys())
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0);
  }
  return [];
}

export function getCurrentSelectedCreatorID() {
  return getSelectedNoteIds();
}

export async function openAliasManagerForSelection() {
  const creatorID = getSelectedNoteIds();
  if (creatorID <= 0) {
    return;
  }
  await onAliasEditorDialog(creatorID);
}

export function openScholarForSelection() {
  const creatorID = getSelectedNoteIds();
  if (creatorID <= 0) {
    return;
  }
  searchAuthorInGoogleScholarByID(creatorID);
}

export function openCNKIForSelection() {
  const creatorID = getSelectedNoteIds();
  if (creatorID <= 0) {
    return;
  }
  searchAuthorInCNKIByID(creatorID);
}

async function runBatchMergeAllAuthors() {
  if (bulkMergeRunning) {
    return;
  }
  bulkMergeRunning = true;
  setBatchMergeStatusMessage(getString("bulk-merge-msg-running"));
  updateButtons();

  try {
    const { phase1Groups, phase2Groups } = await createBatchMergePlan();
    const draftReport: BulkMergeReport = {
      startedAt: Date.now(),
      finishedAt: Date.now(),
      cancelled: false,
      phase1GroupCount: phase1Groups.length,
      phase2GroupCount: phase2Groups.length,
      addedAliasCount: 0,
      mergedGroupCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      entries: [],
    };

    if (phase1Groups.length === 0 && phase2Groups.length === 0) {
      latestBulkMergeReport = draftReport;
      setBatchMergeStatusMessage(getString("bulk-merge-msg-no-candidates"));
      return;
    }

    const precheckText = [
      `${getString("bulk-merge-confirm-phase1")} ${phase1Groups.length}`,
      `${getString("bulk-merge-confirm-phase2")} ${phase2Groups.length}`,
      getString("bulk-merge-confirm-continue"),
    ].join("\n");
    if (!(await askBatchMergePrecheckConfirmation(precheckText))) {
      draftReport.cancelled = true;
      draftReport.finishedAt = Date.now();
      latestBulkMergeReport = draftReport;
      setBatchMergeStatusMessage(getString("bulk-merge-msg-precheck-cancelled"));
      return;
    }

    let globalPhase2Decision: "all-yes" | "all-no" | undefined = undefined;

    for (const group of phase1Groups) {
      if (!isWindowAlive(addon.data.manager.window)) {
        draftReport.cancelled = true;
        break;
      }
      await executeBatchMergeGroup(draftReport, group, "auto");
    }

    for (let index = 0; index < phase2Groups.length; index++) {
      if (!isWindowAlive(addon.data.manager.window)) {
        draftReport.cancelled = true;
        break;
      }
      const group = phase2Groups[index];
      const { targetMainID, candidateMainIDs } = resolveLiveMergeTargets(group);
      if (targetMainID <= 0 || candidateMainIDs.length === 0) {
        await executeBatchMergeGroup(draftReport, group, "skipped");
        continue;
      }

      let decision: BulkMergeDecision = globalPhase2Decision || "no";
      if (!globalPhase2Decision) {
        decision = await askPhase2GroupDecision(
          {
            ...group,
            targetMainID,
            candidateMainIDs,
          },
          index + 1,
          phase2Groups.length,
        );
        if (decision === "all-yes") {
          globalPhase2Decision = "all-yes";
        } else if (decision === "all-no") {
          globalPhase2Decision = "all-no";
        }
      }
      await executeBatchMergeGroup(draftReport, group, decision);
    }

    draftReport.finishedAt = Date.now();
    latestBulkMergeReport = draftReport;
    if (isWindowAlive(addon.data.manager.window)) {
      await refresh();
    }
    await refreshAllOpenAliasManagers();

    if (draftReport.cancelled) {
      setBatchMergeStatusMessage(getString("bulk-merge-msg-cancelled"));
      return;
    }

    if (
      draftReport.addedAliasCount <= 0 &&
      draftReport.mergedGroupCount <= 0 &&
      draftReport.conflictCount <= 0
    ) {
      setBatchMergeStatusMessage(getString("bulk-merge-msg-finished-no-changes"));
      return;
    }

    setBatchMergeStatusMessage(
      getString("bulk-merge-msg-finished", {
        args: {
          added: draftReport.addedAliasCount,
          mergedGroups: draftReport.mergedGroupCount,
          skipped: draftReport.skippedCount,
          conflicts: draftReport.conflictCount,
        },
      }),
    );
  } catch (error) {
    ztoolkit.log?.(`[AuthorBrowser] Batch merge failed: ${String(error)}`);
    setBatchMergeStatusMessage(
      `${getString("bulk-merge-msg-error-prefix")} ${String(error)}`,
    );
  } finally {
    bulkMergeRunning = false;
    updateButtons();
  }
}

async function createBatchMergePlan() {
  const creatorStats = await getAllCreatorStats("itemCount", true);
  const mainRecords = buildMainAuthorRecords(creatorStats);
  const phase1Groups = buildPhase1Groups(mainRecords);
  const phase2Groups = buildPhase2Groups(mainRecords);
  return {
    phase1Groups,
    phase2Groups,
  };
}

function buildMainAuthorRecords(creatorStats: CreatorStatDataRow[]) {
  const statCountMap = new Map<number, number>();
  for (const row of creatorStats) {
    statCountMap.set(row.creatorID, Number(row.itemCount) || 0);
  }

  const mainIDSet = new Set<number>();
  for (const row of creatorStats) {
    const resolvedMainID = resolveMainID(row.creatorID);
    if (resolvedMainID > 0) {
      mainIDSet.add(resolvedMainID);
    }
  }

  const records: MainAuthorRecord[] = [];
  for (const mainID of Array.from(mainIDSet)) {
    const creator = Zotero.Creators.get(mainID);
    if (!creator) {
      continue;
    }
    const memberIDs = expandGroupForMerge(mainID);
    if (!memberIDs || memberIDs.length === 0) {
      continue;
    }
    const itemCount = memberIDs.reduce(
      (count, creatorID) => count + (statCountMap.get(creatorID) || 0),
      0,
    );
    if (itemCount <= 0) {
      continue;
    }
    records.push({
      mainID,
      firstName: creator.firstName || "",
      lastName: creator.lastName || "",
      normalizedFullName: getNormalizedFullName({
        firstName: creator.firstName || "",
        lastName: creator.lastName || "",
      }),
      itemCount,
      hasAliasGroup: hasAliasGroup(mainID),
    });
  }

  return records;
}

function buildPhase1Groups(mainRecords: MainAuthorRecord[]) {
  const recordByID = new Map<number, MainAuthorRecord>(
    mainRecords.map((record) => [record.mainID, record]),
  );
  const groupsByFullName = new Map<string, MainAuthorRecord[]>();

  for (const record of mainRecords) {
    if (!record.normalizedFullName) {
      continue;
    }
    if (!groupsByFullName.has(record.normalizedFullName)) {
      groupsByFullName.set(record.normalizedFullName, []);
    }
    groupsByFullName.get(record.normalizedFullName)!.push(record);
  }

  const groups: BulkMergeGroupPlan[] = [];
  for (const records of groupsByFullName.values()) {
    if (records.length <= 1) {
      continue;
    }
    const sorted = [...records].sort(compareMainAuthorPriority);
    groups.push({
      phase: "phase1-normalized",
      targetMainID: sorted[0].mainID,
      candidateMainIDs: sorted.slice(1).map((record) => record.mainID),
    });
  }

  return groups.sort((a, b) =>
    compareGroupTargetPriority(recordByID, a.targetMainID, b.targetMainID),
  );
}

function buildPhase2Groups(mainRecords: MainAuthorRecord[]) {
  const recordByID = new Map<number, MainAuthorRecord>();
  for (const record of mainRecords) {
    recordByID.set(record.mainID, record);
  }

  const adjacency = new Map<number, Set<number>>();
  for (let i = 0; i < mainRecords.length; i++) {
    const left = mainRecords[i];
    for (let j = i + 1; j < mainRecords.length; j++) {
      const right = mainRecords[j];
      const matchType = getCreatorNameMatchType(left, right);
      if (matchType !== "same-last-name-initial") {
        continue;
      }
      if (!adjacency.has(left.mainID)) {
        adjacency.set(left.mainID, new Set<number>());
      }
      if (!adjacency.has(right.mainID)) {
        adjacency.set(right.mainID, new Set<number>());
      }
      adjacency.get(left.mainID)!.add(right.mainID);
      adjacency.get(right.mainID)!.add(left.mainID);
    }
  }

  const visited = new Set<number>();
  const groups: BulkMergeGroupPlan[] = [];
  for (const startMainID of adjacency.keys()) {
    if (visited.has(startMainID)) {
      continue;
    }
    const queue = [startMainID];
    visited.add(startMainID);
    const component: MainAuthorRecord[] = [];

    while (queue.length > 0) {
      const currentMainID = queue.shift()!;
      const record = recordByID.get(currentMainID);
      if (record) {
        component.push(record);
      }
      const neighbors = adjacency.get(currentMainID) || new Set<number>();
      for (const neighborMainID of neighbors) {
        if (visited.has(neighborMainID)) {
          continue;
        }
        visited.add(neighborMainID);
        queue.push(neighborMainID);
      }
    }

    if (component.length <= 1) {
      continue;
    }

    const sorted = component.sort(compareMainAuthorPriority);
    groups.push({
      phase: "phase2-initial",
      targetMainID: sorted[0].mainID,
      candidateMainIDs: sorted.slice(1).map((record) => record.mainID),
    });
  }

  return groups.sort((a, b) =>
    compareGroupTargetPriority(recordByID, a.targetMainID, b.targetMainID),
  );
}

function compareMainAuthorPriority(a: MainAuthorRecord, b: MainAuthorRecord) {
  if (a.hasAliasGroup !== b.hasAliasGroup) {
    return a.hasAliasGroup ? -1 : 1;
  }
  if (a.itemCount !== b.itemCount) {
    return b.itemCount - a.itemCount;
  }
  return a.mainID - b.mainID;
}

function compareGroupTargetPriority(
  recordByID: Map<number, MainAuthorRecord>,
  leftMainID: number,
  rightMainID: number,
) {
  const left = recordByID.get(leftMainID);
  const right = recordByID.get(rightMainID);
  if (!left && !right) {
    return leftMainID - rightMainID;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return compareMainAuthorPriority(left, right);
}

async function askBatchMergePrecheckConfirmation(precheckText: string) {
  const promptService = Services.prompt;
  const noRemember = { value: false };
  const buttonFlags =
    promptService.BUTTON_POS_0 * promptService.BUTTON_TITLE_IS_STRING +
    promptService.BUTTON_POS_1 * promptService.BUTTON_TITLE_IS_STRING;
  const buttonIndex = promptService.confirmEx(
    getPromptParentWindow(),
    getString("bulk-merge-confirm-title"),
    `${getString("bulk-merge-confirm-intro")}\n\n${precheckText}`,
    buttonFlags,
    getString("bulk-merge-action-yes"),
    getString("bulk-merge-action-no"),
    null,
    null,
    noRemember,
  );
  return buttonIndex === 0;
}

async function askPhase2GroupDecision(
  group: BulkMergeGroupPlan,
  index: number,
  total: number,
): Promise<BulkMergeDecision> {
  const targetLabel = getCreatorLabel(group.targetMainID);
  const candidateLabel = group.candidateMainIDs
    .map((id) => getCreatorLabel(id))
    .join(", ");
  const message = [
    getString("bulk-merge-prompt-progress", {
      args: { index, total },
    }),
    getString("bulk-merge-prompt-target", {
      args: { target: targetLabel },
    }),
    getString("bulk-merge-prompt-candidates", {
      args: { candidates: candidateLabel },
    }),
    getString("bulk-merge-prompt-note"),
  ].join("\n");
  const promptService = Services.prompt;
  const buttonFlags =
    promptService.BUTTON_POS_0 * promptService.BUTTON_TITLE_IS_STRING +
    promptService.BUTTON_POS_1 * promptService.BUTTON_TITLE_IS_STRING +
    promptService.BUTTON_POS_2 * promptService.BUTTON_TITLE_IS_STRING;
  const applyToAll = { value: false };
  const buttonIndex = promptService.confirmEx(
    getPromptParentWindow(),
    getString("bulk-merge-prompt-title"),
    message,
    buttonFlags,
    getString("bulk-merge-action-yes"),
    getString("bulk-merge-action-no"),
    getString("cancel"),
    getString("bulk-merge-prompt-apply-all"),
    applyToAll,
  );
  if (buttonIndex === 0 && applyToAll.value) {
    return "all-yes";
  }
  if (buttonIndex === 1 && applyToAll.value) {
    return "all-no";
  }
  if (buttonIndex === 0) {
    return "yes";
  }
  return "no";
}

function getPromptParentWindow() {
  if (isWindowAlive(addon.data.manager.window)) {
    return addon.data.manager.window;
  }
  return Zotero.getMainWindow();
}

function resolveLiveMergeTargets(group: BulkMergeGroupPlan) {
  const targetMainID = resolveMainID(group.targetMainID);
  const candidateMainIDs = Array.from(
    new Set(group.candidateMainIDs.map((id) => resolveMainID(id))),
  ).filter((id) => id > 0 && id !== targetMainID);
  return {
    targetMainID,
    candidateMainIDs,
  };
}

async function executeBatchMergeGroup(
  report: BulkMergeReport,
  group: BulkMergeGroupPlan,
  decision: BulkMergeDecision,
) {
  const { targetMainID, candidateMainIDs: uniqueCandidateMainIDs } =
    resolveLiveMergeTargets(group);

  if (targetMainID <= 0 || uniqueCandidateMainIDs.length === 0) {
    report.entries.push({
      phase: group.phase,
      targetMainID: targetMainID > 0 ? targetMainID : group.targetMainID,
      targetMainName: getCreatorLabel(
        targetMainID > 0 ? targetMainID : group.targetMainID,
      ),
      candidateMainIDs: uniqueCandidateMainIDs,
      candidateMainNames: uniqueCandidateMainIDs.map((id) => getCreatorLabel(id)),
      decision: "skipped",
      addedAliasCount: 0,
      mergedGroupCount: 0,
      skippedCount: uniqueCandidateMainIDs.length,
      conflictCount: 0,
    });
    return;
  }

  if (decision === "skipped") {
    report.skippedCount += uniqueCandidateMainIDs.length;
    report.entries.push({
      phase: group.phase,
      targetMainID,
      targetMainName: getCreatorLabel(targetMainID),
      candidateMainIDs: uniqueCandidateMainIDs,
      candidateMainNames: uniqueCandidateMainIDs.map((id) => getCreatorLabel(id)),
      decision,
      addedAliasCount: 0,
      mergedGroupCount: 0,
      skippedCount: uniqueCandidateMainIDs.length,
      conflictCount: 0,
    });
    return;
  }

  if (decision === "no" || decision === "all-no") {
    report.skippedCount += uniqueCandidateMainIDs.length;
    report.entries.push({
      phase: group.phase,
      targetMainID,
      targetMainName: getCreatorLabel(targetMainID),
      candidateMainIDs: uniqueCandidateMainIDs,
      candidateMainNames: uniqueCandidateMainIDs.map((id) => getCreatorLabel(id)),
      decision,
      addedAliasCount: 0,
      mergedGroupCount: 0,
      skippedCount: uniqueCandidateMainIDs.length,
      conflictCount: 0,
    });
    return;
  }

  const result = await applyAliasMutation({
    type: "add",
    mainID: targetMainID,
    creatorIDs: uniqueCandidateMainIDs,
    mergeGroups: true,
  });

  report.addedAliasCount += result.addedAliasIDs.length;
  report.mergedGroupCount += result.mergedGroupMainIDs.length;
  report.skippedCount += result.skippedAliasIDs.length;
  report.conflictCount += result.conflictAliasIDs.length;
  report.entries.push({
    phase: group.phase,
    targetMainID,
    targetMainName: getCreatorLabel(targetMainID),
    candidateMainIDs: uniqueCandidateMainIDs,
    candidateMainNames: uniqueCandidateMainIDs.map((id) => getCreatorLabel(id)),
    decision,
    addedAliasCount: result.addedAliasIDs.length,
    mergedGroupCount: result.mergedGroupMainIDs.length,
    skippedCount: result.skippedAliasIDs.length,
    conflictCount: result.conflictAliasIDs.length,
  });
}

function showLatestBatchMergeDetails() {
  if (!latestBulkMergeReport) {
    setBatchMergeStatusMessage(getString("bulk-merge-details-empty"));
    updateButtons();
    return;
  }

  const reportText = formatBatchMergeReport(latestBulkMergeReport);
  const dialogData = createDialogDataWithCompatLocks({
    reportText,
  });
  new ztoolkit.Dialog(1, 1)
    .addCell(0, 0, {
      tag: "textarea",
      namespace: "html",
      attributes: {
        "data-bind": "reportText",
        "data-prop": "value",
        readonly: "readonly",
      },
      styles: {
        width: "100%",
        height: "100%",
        minHeight: "500px",
        resize: "none",
        fontFamily: "Consolas, Menlo, monospace",
      },
    })
    .addButton(getString("cancel"), "close")
    .setDialogData(dialogData)
    .open(getString("bulk-merge-details-title"), {
      width: 980,
      height: 680,
      fitContent: false,
      resizable: true,
      noDialogMode: true,
    });
}

function formatBatchMergeReport(report: BulkMergeReport) {
  if (!report || report.entries.length === 0) {
    return getString("bulk-merge-details-empty");
  }

  const lines: string[] = [];
  lines.push(
    getString("bulk-merge-details-summary", {
      args: {
        added: report.addedAliasCount,
        mergedGroups: report.mergedGroupCount,
        skipped: report.skippedCount,
        conflicts: report.conflictCount,
      },
    }),
  );
  lines.push("");

  const phase1Entries = report.entries.filter(
    (entry) => entry.phase === "phase1-normalized",
  );
  const phase2Entries = report.entries.filter(
    (entry) => entry.phase === "phase2-initial",
  );

  lines.push(getString("bulk-merge-details-stage1"));
  if (phase1Entries.length === 0) {
    lines.push(`  ${getString("bulk-merge-details-none")}`);
  } else {
    for (const entry of phase1Entries) {
      lines.push(`  ${formatBatchMergeReportEntry(entry)}`);
    }
  }

  lines.push("");
  lines.push(getString("bulk-merge-details-stage2"));
  if (phase2Entries.length === 0) {
    lines.push(`  ${getString("bulk-merge-details-none")}`);
  } else {
    for (const entry of phase2Entries) {
      lines.push(`  ${formatBatchMergeReportEntry(entry)}`);
    }
  }

  return lines.join("\n");
}

function formatBatchMergeReportEntry(entry: BulkMergeDetailEntry) {
  const decisionLabel = getBatchMergeDecisionLabel(entry.decision);
  const candidates =
    entry.candidateMainNames.length > 0
      ? entry.candidateMainNames.join(", ")
      : getString("bulk-merge-details-none");
  return (
    `${entry.targetMainName} <- ${candidates} | ` +
    `${getString("bulk-merge-details-decision-label")}: ${decisionLabel} | ` +
    `${getString("bulk-merge-details-added-label")}: ${entry.addedAliasCount} | ` +
    `${getString("bulk-merge-details-merged-groups-label")}: ${entry.mergedGroupCount} | ` +
    `${getString("bulk-merge-details-skipped-label")}: ${entry.skippedCount} | ` +
    `${getString("bulk-merge-details-conflict-label")}: ${entry.conflictCount}`
  );
}

function getBatchMergeDecisionLabel(decision: BulkMergeDecision) {
  if (decision === "auto") {
    return getString("bulk-merge-details-decision-auto");
  }
  if (decision === "yes") {
    return getString("bulk-merge-details-decision-yes");
  }
  if (decision === "all-yes") {
    return getString("bulk-merge-details-decision-all-yes");
  }
  if (decision === "all-no") {
    return getString("bulk-merge-details-decision-all-no");
  }
  if (decision === "no") {
    return getString("bulk-merge-details-decision-no");
  }
  return getString("bulk-merge-details-decision-skipped");
}

function getCreatorLabel(creatorID: number) {
  const creator = Zotero.Creators.get(creatorID);
  if (!creator) {
    return `ID: ${creatorID}`;
  }
  const fullName = `${(creator.firstName || "").trim()} ${(creator.lastName || "").trim()}`.trim();
  if (!fullName) {
    return `ID: ${creatorID}`;
  }
  return `${fullName} (ID: ${creatorID})`;
}

function setBatchMergeStatusMessage(message: string) {
  bulkMergeStatusMessage = message || "";
  if (!isWindowAlive(addon.data.manager.window)) {
    return;
  }
  const messageNode = addon.data.manager.window?.document.querySelector(
    "#bulk-merge-message",
  ) as HTMLElement | null;
  if (messageNode) {
    messageNode.textContent = bulkMergeStatusMessage;
  }
}

function showAuthorListContextMenu(ev: Event, x: number, y: number) {
  const win = addon.data.manager.window;
  if (!win) {
    return;
  }
  const rawEvent = ev as any;
  rawEvent?.preventDefault?.();
  rawEvent?.stopPropagation?.();
  selectRowFromContextMenuEvent(ev);
  updateButtons();
  const popup = win.document.querySelector(
    "#author-list-context-menu",
  ) as XULPopupElement | null;
  if (!popup || typeof popup.openPopupAtScreen !== "function") {
    return;
  }
  const screenX =
    Number.isFinite(Number(x)) && Number(x) >= 0
      ? Number(x)
      : Number(rawEvent?.screenX) || 0;
  const screenY =
    Number.isFinite(Number(y)) && Number(y) >= 0
      ? Number(y)
      : Number(rawEvent?.screenY) || 0;
  popup.openPopupAtScreen(screenX, screenY, true);
}

function selectRowFromContextMenuEvent(ev: Event) {
  const tableHelper = addon.data.manager.tableHelper;
  const selection = tableHelper?.treeInstance?.selection;
  if (!selection || typeof selection.select !== "function") {
    return;
  }

  const rowIndex = getRowIndexFromContextMenuEvent(ev);
  if (
    Number.isInteger(rowIndex) &&
    rowIndex >= 0 &&
    rowIndex < addon.data.manager.data.length
  ) {
    selection.select(rowIndex);
  }
}

function getRowIndexFromContextMenuEvent(ev: Event) {
  const rawEvent = ev as any;
  const directIndexCandidates = [
    rawEvent?.index,
    rawEvent?.row,
    rawEvent?.rowIndex,
  ];
  for (const candidate of directIndexCandidates) {
    const parsedCandidate = Number(candidate);
    if (Number.isInteger(parsedCandidate) && parsedCandidate >= 0) {
      return parsedCandidate;
    }
  }

  const target = rawEvent?.target as Element | null;
  if (!target || typeof target.closest !== "function") {
    return -1;
  }

  const containers: Array<Element> = [];
  const closestWithKnownAttr = target.closest(
    "[data-row-index], [data-row], [data-index]",
  );
  if (closestWithKnownAttr) {
    containers.push(closestWithKnownAttr);
  }
  const closestRow = target.closest('[role="row"], .row');
  if (closestRow) {
    containers.push(closestRow);
  }

  for (const container of containers) {
    const attrCandidates = [
      container.getAttribute("data-row-index"),
      container.getAttribute("data-row"),
      container.getAttribute("data-index"),
      (container as any).dataset?.rowIndex,
      (container as any).dataset?.row,
      (container as any).dataset?.index,
    ];
    for (const attrValue of attrCandidates) {
      const parsedAttrValue = Number(attrValue);
      if (Number.isInteger(parsedAttrValue) && parsedAttrValue >= 0) {
        return parsedAttrValue;
      }
    }
  }

  return -1;
}

async function swapNames(creatorID: number) {
  if (creatorID <= 0) {
    return;
  }
  const fields = Zotero.Creators.get(creatorID);
  if (!fields) {
    return;
  }
  const lastName = fields.lastName;
  const firstName = fields.firstName;
  fields.lastName = firstName;
  fields.firstName = lastName;
  await Zotero.Creators.updateCreator(creatorID, fields);
}

function canCapitalizeCreatorName(creatorID: number) {
  if (creatorID <= 0) {
    return false;
  }
  const fields = Zotero.Creators.get(creatorID);
  if (!fields) {
    return false;
  }
  return (
    (fields.firstName &&
      Zotero.Utilities.capitalizeName(fields.firstName) != fields.firstName) ||
    (fields.lastName &&
      Zotero.Utilities.capitalizeName(fields.lastName) != fields.lastName)
  );
}

async function capitalizeCreatorName() {
  const creatorID = getSelectedNoteIds();
  if (creatorID <= 0) {
    return;
  }
  const fields = Zotero.Creators.get(creatorID);
  if (!fields) {
    return;
  }
  fields.lastName = Zotero.Utilities.capitalizeName(fields.lastName);
  fields.firstName = Zotero.Utilities.capitalizeName(fields.firstName);
  await Zotero.Creators.updateCreator(creatorID, fields);
  await refresh();
}

export async function remnameDialog(creatorID: number) {
  if (creatorID <= 0) {
    return;
  }
  const creator = Zotero.Creators.get(creatorID);
  if (!creator) {
    return;
  }
  const dialogData = createDialogDataWithCompatLocks({
    creatorID: creatorID,
    firstName: creator.firstName,
    lastName: creator.lastName,
  });
  const dialogHelper = new ztoolkit.Dialog(1, 4)
    .addCell(0, 0, {
      tag: "label",
      namespace: "html",
      attributes: {
        for: "first-name-input",
      },
      properties: { innerHTML: getString("first-name") + ": " },
      styles: {
        padding: "0px 10px",
        margin: "auto",
      },
    })
    .addCell(0, 1, {
      tag: "input",
      namespace: "html",
      id: "first-name-input",
      attributes: {
        "data-bind": "firstName",
        "data-prop": "value",
        type: "text",
      },
    })
    .addCell(0, 2, {
      tag: "label",
      namespace: "html",
      attributes: {
        for: "last-name-input",
      },
      properties: { innerHTML: getString("last-name") + ": " },
      styles: {
        padding: "0px 10px",
        margin: "auto",
      },
    })
    .addCell(0, 3, {
      tag: "input",
      namespace: "html",
      id: "last-name-input",
      attributes: {
        "data-bind": "lastName",
        "data-prop": "value",
        type: "text",
      },
    })
    .addButton(getString("save-and-close"), "save")
    .addButton(getString("cancel"), "cancel")
    .setDialogData(dialogData)
    .open(
      getString("rename-for-prefix") +
        creator.firstName +
        " " +
        creator.lastName +
        getString("rename-for-suffix"),
    );
  addon.data.manager.renameDialog = dialogHelper;
  await dialogData.unloadLock.promise;
  if (dialogData._lastButtonId == "save") {
    const fields = Zotero.Creators.get(creatorID);
    fields.firstName = dialogData.firstName;
    fields.lastName = dialogData.lastName;
    await Zotero.Creators.updateCreator(creatorID, fields);
  }
  if (dialogData._lastButtons) addon.data.manager.renameDialog = undefined;
}

export async function refreshIfOpen() {
  if (!isWindowAlive(addon.data.manager.window)) {
    return;
  }
  await refresh();
}
