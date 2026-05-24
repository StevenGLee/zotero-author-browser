/// @ts-nocheck
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { isWindowAlive } from "../utils/window";
import {
  applyAliasMutation,
  CreatorStatDataRow,
  expandGroupForMerge,
  getAllAliasByMainID,
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
  getFirstNameSignature,
  hasAbbreviationForm,
  isPureAbbreviationForm,
  getNormalizedFullName,
} from "./authorNameMatch";

type BulkMergePhase =
  | "phase1-normalized"
  | "phase1-abbrev"
  | "phase2-ambiguous"
  | "phase2-manual";
type BulkMergeDecision =
  | "auto-normalized"
  | "auto-abbrev"
  | "manual-yes"
  | "manual-no"
  | "manual-all-yes"
  | "manual-all-no"
  | "ambiguous-selected"
  | "ambiguous-skipped"
  | "skipped";

interface BulkMergeAutoGroupPlan {
  phase: BulkMergePhase;
  targetMainID: number;
  candidateMainIDs: number[];
}

interface BulkMergeManualPairPlan {
  phase: "phase2-manual";
  targetMainID: number;
  candidateMainID: number;
}

interface BulkMergeAmbiguousPlan {
  phase: "phase2-ambiguous";
  abbrevMainID: number;
  candidateMainIDs: number[];
}

interface BulkMergePlan {
  autoNormalizedGroups: BulkMergeAutoGroupPlan[];
  autoAbbrevGroups: BulkMergeAutoGroupPlan[];
  ambiguousGroups: BulkMergeAmbiguousPlan[];
  manualPairs: BulkMergeManualPairPlan[];
}

interface BulkMergeDetailEntry {
  phase: BulkMergePhase;
  targetMainID: number;
  targetMainName: string;
  candidateMainIDs: number[];
  candidateMainNames: string[];
  decision: BulkMergeDecision;
  reason: string;
  addedAliasCount: number;
  mergedGroupCount: number;
  skippedCount: number;
  conflictCount: number;
}

interface BulkMergeReport {
  startedAt: number;
  finishedAt: number;
  cancelled: boolean;
  phase1NormalizedCount: number;
  phase1AbbrevCount: number;
  phase2AmbiguousCount: number;
  phase2ManualCount: number;
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
  firstNameSignature: string;
  hasAbbreviationForm: boolean;
  isPureAbbreviation: boolean;
  itemCount: number;
  hasAliasGroup: boolean;
}

interface BulkMergePairEdge {
  leftMainID: number;
  rightMainID: number;
}

interface AuthorPreviewItemRow {
  itemID: number;
  title: string;
  year: string;
}

type AmbiguousWindowDecision =
  | {
      action: "selected";
      selectedMainID: number;
    }
  | {
      action: "skip-current";
    }
  | {
      action: "skip-all";
    };

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

export async function runBatchMergeFromToolMenu() {
  if (bulkMergeRunning) {
    return;
  }
  await runBatchMergeAllAuthors({
    headless: true,
  });
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

async function runBatchMergeAllAuthors(
  options: {
    headless?: boolean;
  } = {},
) {
  const headless = !!options.headless;
  if (bulkMergeRunning) {
    return;
  }
  bulkMergeRunning = true;
  setBatchMergeStatusMessage(getString("bulk-merge-msg-running"));
  updateButtons();

  try {
    const plan = await createBatchMergePlan();
    const {
      autoNormalizedGroups,
      autoAbbrevGroups,
      ambiguousGroups,
      manualPairs,
    } = plan;
    const draftReport: BulkMergeReport = {
      startedAt: Date.now(),
      finishedAt: Date.now(),
      cancelled: false,
      phase1NormalizedCount: autoNormalizedGroups.length,
      phase1AbbrevCount: autoAbbrevGroups.length,
      phase2AmbiguousCount: ambiguousGroups.length,
      phase2ManualCount: manualPairs.length,
      addedAliasCount: 0,
      mergedGroupCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      entries: [],
    };

    if (
      autoNormalizedGroups.length === 0 &&
      autoAbbrevGroups.length === 0 &&
      ambiguousGroups.length === 0 &&
      manualPairs.length === 0
    ) {
      latestBulkMergeReport = draftReport;
      setBatchMergeStatusMessage(getString("bulk-merge-msg-no-candidates"));
      if (headless) {
        Services.prompt.alert(
          getPromptParentWindow(),
          getString("bulk-merge-confirm-title"),
          getString("bulk-merge-msg-no-candidates"),
        );
      }
      return;
    }

    const precheckText = [
      `${getString("bulk-merge-confirm-phase1a")} ${autoNormalizedGroups.length}`,
      `${getString("bulk-merge-confirm-phase1b")} ${autoAbbrevGroups.length}`,
      `${getString("bulk-merge-confirm-phase2b")} ${manualPairs.length}`,
      `${getString("bulk-merge-confirm-phase2a")} ${ambiguousGroups.length}`,
      getString("bulk-merge-confirm-continue"),
    ].join("\n");
    if (!(await askBatchMergePrecheckConfirmation(precheckText))) {
      draftReport.cancelled = true;
      draftReport.finishedAt = Date.now();
      latestBulkMergeReport = draftReport;
      setBatchMergeStatusMessage(getString("bulk-merge-msg-precheck-cancelled"));
      if (headless) {
        Services.prompt.alert(
          getPromptParentWindow(),
          getString("bulk-merge-confirm-title"),
          getString("bulk-merge-msg-precheck-cancelled"),
        );
      }
      return;
    }

    let globalManualDecision: "manual-all-yes" | "manual-all-no" | undefined =
      undefined;

    for (const group of autoNormalizedGroups) {
      if (!headless && !isWindowAlive(addon.data.manager.window)) {
        draftReport.cancelled = true;
        break;
      }
      await executeBatchMergeGroup(
        draftReport,
        group,
        "auto-normalized",
        getString("bulk-merge-reason-auto-normalized"),
      );
    }

    for (const group of autoAbbrevGroups) {
      if (!headless && !isWindowAlive(addon.data.manager.window)) {
        draftReport.cancelled = true;
        break;
      }
      await executeBatchMergeGroup(
        draftReport,
        group,
        "auto-abbrev",
        getString("bulk-merge-reason-auto-abbrev"),
      );
    }

    for (let index = 0; index < manualPairs.length; index++) {
      if (!headless && !isWindowAlive(addon.data.manager.window)) {
        draftReport.cancelled = true;
        break;
      }
      const pair = manualPairs[index];
      const { targetMainID, candidateMainIDs } = resolveLiveMergeTargets({
        phase: "phase2-manual",
        targetMainID: pair.targetMainID,
        candidateMainIDs: [pair.candidateMainID],
      });
      if (targetMainID <= 0 || candidateMainIDs.length === 0) {
        await executeBatchMergeGroup(
          draftReport,
          {
            phase: "phase2-manual",
            targetMainID: pair.targetMainID,
            candidateMainIDs: [pair.candidateMainID],
          },
          "skipped",
          getString("bulk-merge-reason-manual"),
        );
        continue;
      }

      let decision: BulkMergeDecision = globalManualDecision || "manual-no";
      if (!globalManualDecision) {
        decision = await askPhase2GroupDecision(
          {
            phase: "phase2-manual",
            targetMainID,
            candidateMainIDs,
          },
          index + 1,
          manualPairs.length,
        );
        if (decision === "manual-all-yes") {
          globalManualDecision = "manual-all-yes";
        } else if (decision === "manual-all-no") {
          globalManualDecision = "manual-all-no";
        }
      }
      await executeBatchMergeGroup(
        draftReport,
        {
          phase: "phase2-manual",
          targetMainID: pair.targetMainID,
          candidateMainIDs: [pair.candidateMainID],
        },
        decision,
        getString("bulk-merge-reason-manual"),
      );
    }

    for (let index = 0; index < ambiguousGroups.length; index++) {
      if (!headless && !isWindowAlive(addon.data.manager.window)) {
        draftReport.cancelled = true;
        break;
      }
      const group = ambiguousGroups[index];
      const { abbrevMainID, candidateMainIDs } = resolveLiveAmbiguousTargets(group);
      if (abbrevMainID <= 0 || candidateMainIDs.length === 0) {
        recordAmbiguousSkip(
          draftReport,
          group.abbrevMainID,
          candidateMainIDs,
          getString("bulk-merge-reason-ambiguous-window"),
        );
        continue;
      }

      const decision = await askAmbiguousGroupDecision(
        {
          ...group,
          abbrevMainID,
          candidateMainIDs,
        },
        index + 1,
        ambiguousGroups.length,
      );
      if (decision.action === "selected") {
        await executeAmbiguousSelectedMerge(
          draftReport,
          abbrevMainID,
          decision.selectedMainID,
          getString("bulk-merge-reason-ambiguous-window"),
        );
        continue;
      }

      recordAmbiguousSkip(
        draftReport,
        abbrevMainID,
        candidateMainIDs,
        getString("bulk-merge-reason-ambiguous-window"),
      );

      if (decision.action === "skip-all") {
        for (let rest = index + 1; rest < ambiguousGroups.length; rest++) {
          const restGroup = ambiguousGroups[rest];
          const { abbrevMainID: restAbbrevMainID, candidateMainIDs: restCandidates } =
            resolveLiveAmbiguousTargets(restGroup);
          recordAmbiguousSkip(
            draftReport,
            restAbbrevMainID > 0 ? restAbbrevMainID : restGroup.abbrevMainID,
            restCandidates,
            getString("bulk-merge-reason-ambiguous-window"),
          );
        }
        break;
      }
    }

    draftReport.finishedAt = Date.now();
    latestBulkMergeReport = draftReport;
    if (isWindowAlive(addon.data.manager.window)) {
      await refresh();
    }
    await refreshAllOpenAliasManagers();

    if (draftReport.cancelled) {
      setBatchMergeStatusMessage(getString("bulk-merge-msg-cancelled"));
      if (headless) {
        Services.prompt.alert(
          getPromptParentWindow(),
          getString("bulk-merge-confirm-title"),
          getString("bulk-merge-msg-cancelled"),
        );
      }
      return;
    }

    if (
      draftReport.addedAliasCount <= 0 &&
      draftReport.mergedGroupCount <= 0 &&
      draftReport.conflictCount <= 0
    ) {
      setBatchMergeStatusMessage(getString("bulk-merge-msg-finished-no-changes"));
      if (headless) {
        Services.prompt.alert(
          getPromptParentWindow(),
          getString("bulk-merge-confirm-title"),
          getString("bulk-merge-msg-finished-no-changes"),
        );
      }
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
    if (headless) {
      Services.prompt.alert(
        getPromptParentWindow(),
        getString("bulk-merge-confirm-title"),
        getString("bulk-merge-msg-finished", {
          args: {
            added: draftReport.addedAliasCount,
            mergedGroups: draftReport.mergedGroupCount,
            skipped: draftReport.skippedCount,
            conflicts: draftReport.conflictCount,
          },
        }),
      );
    }
  } catch (error) {
    ztoolkit.log?.(`[AuthorBrowser] Batch merge failed: ${String(error)}`);
    setBatchMergeStatusMessage(
      `${getString("bulk-merge-msg-error-prefix")} ${String(error)}`,
    );
    if (headless) {
      Services.prompt.alert(
        getPromptParentWindow(),
        getString("bulk-merge-confirm-title"),
        `${getString("bulk-merge-msg-error-prefix")} ${String(error)}`,
      );
    }
  } finally {
    bulkMergeRunning = false;
    updateButtons();
  }
}

async function createBatchMergePlan() {
  const creatorStats = await getAllCreatorStats("itemCount", true);
  const mainRecords = buildMainAuthorRecords(creatorStats);
  const normalizedGroups = buildPhase1NormalizedGroups(mainRecords);
  const { highConfidenceEdges, manualEdges } = buildMatchEdges(mainRecords);
  const ambiguousGroups = buildAmbiguousGroups(mainRecords, highConfidenceEdges);
  const ambiguousPairKeySet = getAmbiguousPairKeySet(ambiguousGroups);
  const filteredHighConfidenceEdges = highConfidenceEdges.filter(
    (edge) => !ambiguousPairKeySet.has(getPairKey(edge.leftMainID, edge.rightMainID)),
  );
  const autoAbbrevGroups = buildAutoGroupsFromEdges(
    mainRecords,
    filteredHighConfidenceEdges,
  );
  const manualPairs = buildManualPairs(
    mainRecords,
    manualEdges.filter(
      (edge) =>
        !ambiguousPairKeySet.has(getPairKey(edge.leftMainID, edge.rightMainID)),
    ),
  );
  return {
    autoNormalizedGroups: normalizedGroups,
    autoAbbrevGroups,
    ambiguousGroups,
    manualPairs,
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
      firstNameSignature: getFirstNameSignature(creator.firstName || ""),
      hasAbbreviationForm: hasAbbreviationForm(creator.firstName || ""),
      isPureAbbreviation: isPureAbbreviationForm(creator.firstName || ""),
      itemCount,
      hasAliasGroup: hasAliasGroup(mainID),
    });
  }

  return records;
}

function buildPhase1NormalizedGroups(mainRecords: MainAuthorRecord[]) {
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

  const groups: BulkMergeAutoGroupPlan[] = [];
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

function buildMatchEdges(mainRecords: MainAuthorRecord[]) {
  const highConfidenceEdges: BulkMergePairEdge[] = [];
  const manualEdges: BulkMergePairEdge[] = [];
  for (let i = 0; i < mainRecords.length; i++) {
    const left = mainRecords[i];
    for (let j = i + 1; j < mainRecords.length; j++) {
      const right = mainRecords[j];
      const matchType = getCreatorNameMatchType(left, right);
      if (matchType === "abbrev-high-confidence") {
        highConfidenceEdges.push({
          leftMainID: left.mainID,
          rightMainID: right.mainID,
        });
      } else if (matchType === "same-last-name-initial-manual") {
        manualEdges.push({
          leftMainID: left.mainID,
          rightMainID: right.mainID,
        });
      }
    }
  }
  return {
    highConfidenceEdges,
    manualEdges,
  };
}

function buildAmbiguousGroups(
  mainRecords: MainAuthorRecord[],
  highConfidenceEdges: BulkMergePairEdge[],
) {
  const recordByID = new Map<number, MainAuthorRecord>(
    mainRecords.map((record) => [record.mainID, record]),
  );
  const candidatesByAbbrevID = new Map<number, Set<number>>();
  for (const edge of highConfidenceEdges) {
    const left = recordByID.get(edge.leftMainID);
    const right = recordByID.get(edge.rightMainID);
    if (!left || !right) {
      continue;
    }

    if (
      left.isPureAbbreviation &&
      left.firstNameSignature.length <= 1 &&
      right.mainID !== left.mainID
    ) {
      if (!candidatesByAbbrevID.has(left.mainID)) {
        candidatesByAbbrevID.set(left.mainID, new Set<number>());
      }
      candidatesByAbbrevID.get(left.mainID)!.add(right.mainID);
    }
    if (
      right.isPureAbbreviation &&
      right.firstNameSignature.length <= 1 &&
      left.mainID !== right.mainID
    ) {
      if (!candidatesByAbbrevID.has(right.mainID)) {
        candidatesByAbbrevID.set(right.mainID, new Set<number>());
      }
      candidatesByAbbrevID.get(right.mainID)!.add(left.mainID);
    }
  }

  const groups: BulkMergeAmbiguousPlan[] = [];
  for (const [abbrevMainID, candidateSet] of candidatesByAbbrevID) {
    const candidates = Array.from(candidateSet).filter((id) => id > 0);
    if (candidates.length <= 1) {
      continue;
    }
    const sortedCandidates = candidates.sort((leftID, rightID) =>
      compareGroupTargetPriority(recordByID, leftID, rightID),
    );
    groups.push({
      phase: "phase2-ambiguous",
      abbrevMainID,
      candidateMainIDs: sortedCandidates,
    });
  }

  return groups.sort((left, right) =>
    compareGroupTargetPriority(recordByID, left.abbrevMainID, right.abbrevMainID),
  );
}

function getAmbiguousPairKeySet(groups: BulkMergeAmbiguousPlan[]) {
  const pairKeySet = new Set<string>();
  for (const group of groups) {
    for (const candidateMainID of group.candidateMainIDs) {
      pairKeySet.add(getPairKey(group.abbrevMainID, candidateMainID));
    }
  }
  return pairKeySet;
}

function buildAutoGroupsFromEdges(
  mainRecords: MainAuthorRecord[],
  edges: BulkMergePairEdge[],
) {
  const recordByID = new Map<number, MainAuthorRecord>(
    mainRecords.map((record) => [record.mainID, record]),
  );
  const adjacency = new Map<number, Set<number>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.leftMainID)) {
      adjacency.set(edge.leftMainID, new Set<number>());
    }
    if (!adjacency.has(edge.rightMainID)) {
      adjacency.set(edge.rightMainID, new Set<number>());
    }
    adjacency.get(edge.leftMainID)!.add(edge.rightMainID);
    adjacency.get(edge.rightMainID)!.add(edge.leftMainID);
  }

  const groups: BulkMergeAutoGroupPlan[] = [];
  const visited = new Set<number>();
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
      phase: "phase1-abbrev",
      targetMainID: sorted[0].mainID,
      candidateMainIDs: sorted.slice(1).map((record) => record.mainID),
    });
  }

  return groups.sort((a, b) =>
    compareGroupTargetPriority(recordByID, a.targetMainID, b.targetMainID),
  );
}

function buildManualPairs(
  mainRecords: MainAuthorRecord[],
  edges: BulkMergePairEdge[],
) {
  const recordByID = new Map<number, MainAuthorRecord>(
    mainRecords.map((record) => [record.mainID, record]),
  );
  const pairsByKey = new Map<string, BulkMergeManualPairPlan>();
  for (const edge of edges) {
    const left = recordByID.get(edge.leftMainID);
    const right = recordByID.get(edge.rightMainID);
    if (!left || !right) {
      continue;
    }
    const target = compareMainAuthorPriority(left, right) <= 0 ? left : right;
    const candidate = target.mainID === left.mainID ? right : left;
    const key = `${target.mainID}->${candidate.mainID}`;
    if (!pairsByKey.has(key)) {
      pairsByKey.set(key, {
        phase: "phase2-manual",
        targetMainID: target.mainID,
        candidateMainID: candidate.mainID,
      });
    }
  }

  return Array.from(pairsByKey.values()).sort((left, right) => {
    const targetCompare = compareGroupTargetPriority(
      recordByID,
      left.targetMainID,
      right.targetMainID,
    );
    if (targetCompare !== 0) {
      return targetCompare;
    }
    return compareGroupTargetPriority(
      recordByID,
      left.candidateMainID,
      right.candidateMainID,
    );
  });
}

function getPairKey(leftMainID: number, rightMainID: number) {
  if (leftMainID <= rightMainID) {
    return `${leftMainID}-${rightMainID}`;
  }
  return `${rightMainID}-${leftMainID}`;
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
  group: {
    phase: "phase2-manual";
    targetMainID: number;
    candidateMainIDs: number[];
  },
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
    getString("bulk-merge-action-skip-rest-no"),
    getString("bulk-merge-prompt-apply-all"),
    applyToAll,
  );
  if (buttonIndex !== 0 && buttonIndex !== 1) {
    return "manual-all-no";
  }
  if (buttonIndex === 0 && applyToAll.value) {
    return "manual-all-yes";
  }
  if (buttonIndex === 1 && applyToAll.value) {
    return "manual-all-no";
  }
  if (buttonIndex === 0) {
    return "manual-yes";
  }
  return "manual-no";
}

async function askAmbiguousGroupDecision(
  group: BulkMergeAmbiguousPlan,
  index: number,
  total: number,
): Promise<AmbiguousWindowDecision> {
  const windowArgs = {
    _initPromise: Zotero.Promise.defer(),
  };
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/AmbiguousMergeWindow.xhtml`,
    `${config.addonRef}-ambiguousMergeWindow`,
    `chrome,centerscreen,resizable,status,dialog=no`,
    windowArgs,
  )!;
  await windowArgs._initPromise.promise;

  const progressNode = win.document.querySelector(
    "#progress-text",
  ) as HTMLElement | null;
  const noteNode = win.document.querySelector(
    "#ambiguous-note",
  ) as HTMLElement | null;
  const leftAuthorNameNode = win.document.querySelector(
    "#left-author-name",
  ) as HTMLElement | null;
  const rightAuthorNameNode = win.document.querySelector(
    "#right-author-name",
  ) as HTMLElement | null;
  const candidateSelect = win.document.querySelector(
    "#candidate-select",
  ) as HTMLSelectElement | null;
  const leftItemList = win.document.querySelector(
    "#left-item-list",
  ) as HTMLUListElement | null;
  const rightItemList = win.document.querySelector(
    "#right-item-list",
  ) as HTMLUListElement | null;
  const messageNode = win.document.querySelector(
    "#ambiguous-merge-message",
  ) as HTMLElement | null;
  const mergeButton = win.document.querySelector(
    "#merge-selected",
  ) as HTMLButtonElement | null;
  const skipButton = win.document.querySelector(
    "#skip-merge",
  ) as HTMLButtonElement | null;
  const closeButton = win.document.querySelector(
    "#close-window",
  ) as HTMLButtonElement | null;

  if (!candidateSelect || !mergeButton || !skipButton || !closeButton) {
    try {
      win.close();
    } catch (e) {
      ztoolkit.log?.(`[AuthorBrowser] Close ambiguous window failed: ${String(e)}`);
    }
    return { action: "skip-current" };
  }

  if (progressNode) {
    progressNode.textContent = getString("bulk-merge-ambiguous-progress", {
      args: { index, total },
    });
  }
  if (noteNode) {
    noteNode.textContent = getString("bulk-merge-ambiguous-note");
  }
  if (leftAuthorNameNode) {
    leftAuthorNameNode.textContent = getCreatorLabel(group.abbrevMainID);
  }

  const leftItems = await getAuthorPreviewItemsForMain(group.abbrevMainID);
  renderPreviewItems(leftItemList, leftItems);

  for (const candidateMainID of group.candidateMainIDs) {
    const option = win.document.createElement("option");
    option.value = String(candidateMainID);
    option.textContent = getCreatorLabel(candidateMainID);
    candidateSelect.appendChild(option);
  }

  const rightItemCache = new Map<number, AuthorPreviewItemRow[]>();
  const setMessage = (message: string) => {
    if (messageNode) {
      messageNode.textContent = message;
    }
  };

  let currentSelectedMainID = group.candidateMainIDs[0] || -1;
  let switchToken = 0;
  const updateRightPanel = async () => {
    const selectedMainID = Number(candidateSelect.value) || -1;
    currentSelectedMainID = selectedMainID;
    if (rightAuthorNameNode) {
      rightAuthorNameNode.textContent =
        selectedMainID > 0 ? getCreatorLabel(selectedMainID) : "-";
    }
    if (selectedMainID <= 0) {
      renderPreviewItems(rightItemList, []);
      return;
    }

    const token = ++switchToken;
    setMessage(getString("bulk-merge-ambiguous-loading"));
    if (!rightItemCache.has(selectedMainID)) {
      rightItemCache.set(
        selectedMainID,
        await getAuthorPreviewItemsForMain(selectedMainID),
      );
    }
    if (token !== switchToken) {
      return;
    }
    renderPreviewItems(rightItemList, rightItemCache.get(selectedMainID) || []);
    setMessage("");
  };

  candidateSelect.addEventListener("change", () => {
    updateRightPanel();
  });
  if (group.candidateMainIDs.length > 0) {
    candidateSelect.value = String(group.candidateMainIDs[0]);
    await updateRightPanel();
  } else {
    renderPreviewItems(rightItemList, []);
  }

  bindPreviewOpenInLibrary(leftItemList);
  bindPreviewOpenInLibrary(rightItemList);

  const result = await new Promise<AmbiguousWindowDecision>((resolve) => {
    let resolved = false;
    const finish = (decision: AmbiguousWindowDecision) => {
      if (resolved) {
        return;
      }
      resolved = true;
      try {
        if (isWindowAlive(win)) {
          win.close();
        }
      } catch (e) {
        ztoolkit.log?.(`[AuthorBrowser] Close ambiguous window failed: ${String(e)}`);
      }
      resolve(decision);
    };

    mergeButton.addEventListener("click", () => {
      if (currentSelectedMainID <= 0) {
        setMessage(getString("bulk-merge-ambiguous-select-required"));
        return;
      }
      finish({
        action: "selected",
        selectedMainID: currentSelectedMainID,
      });
    });
    skipButton.addEventListener("click", () => {
      finish({ action: "skip-current" });
    });
    closeButton.addEventListener("click", () => {
      finish({ action: "skip-all" });
    });
    win.addEventListener("unload", () => {
      finish({ action: "skip-current" });
    });
  });

  return result;
}

function bindPreviewOpenInLibrary(listNode: HTMLUListElement | null) {
  if (!listNode) {
    return;
  }
  listNode.addEventListener("dblclick", (event) => {
    const targetNode = event.target as Element | null;
    const itemNode = targetNode?.closest?.("li[data-item-id]") as
      | HTMLLIElement
      | null;
    if (!itemNode) {
      return;
    }
    const itemID = Number(itemNode.dataset.itemId) || -1;
    if (itemID > 0) {
      openItemInMainWindow(itemID);
    }
  });
}

function renderPreviewItems(
  listNode: HTMLUListElement | null,
  items: AuthorPreviewItemRow[],
) {
  if (!listNode) {
    return;
  }
  listNode.innerHTML = "";
  if (!items || items.length === 0) {
    const placeholder = listNode.ownerDocument.createElement("li");
    placeholder.className = "placeholder";
    placeholder.textContent = getString("bulk-merge-ambiguous-no-items");
    listNode.appendChild(placeholder);
    return;
  }
  for (const item of items) {
    const li = listNode.ownerDocument.createElement("li");
    li.dataset.itemId = String(item.itemID);
    li.title = item.title;
    const year = item.year ? `[${item.year}] ` : "";
    li.textContent = `${year}${item.title}`;
    listNode.appendChild(li);
  }
}

async function getAuthorPreviewItemsForMain(mainID: number, limit = 120) {
  const resolvedMainID = resolveMainID(mainID);
  if (resolvedMainID <= 0) {
    return [];
  }
  const creator = Zotero.Creators.get(resolvedMainID);
  if (!creator) {
    return [];
  }

  const names = new Set<string>();
  const mainFullName = formatCreatorFullName(creator.firstName, creator.lastName);
  if (mainFullName) {
    names.add(mainFullName);
  }
  const aliases = getAllAliasByMainID(resolvedMainID);
  for (const aliasID of aliases) {
    const aliasCreator = Zotero.Creators.get(aliasID);
    if (!aliasCreator) {
      continue;
    }
    const aliasFullName = formatCreatorFullName(
      aliasCreator.firstName,
      aliasCreator.lastName,
    );
    if (aliasFullName) {
      names.add(aliasFullName);
    }
  }
  if (names.size === 0) {
    return [];
  }

  const search = new Zotero.Search({
    libraryID: Zotero.Libraries.userLibraryID,
  });
  search.addCondition("joinMode", "any");
  for (const fullName of Array.from(names)) {
    search.addCondition("creator", "is", fullName);
  }
  const itemIDs = (await search.search()) || [];
  const uniqueIDs = Array.from(
    new Set(itemIDs.map((id) => Number(id)).filter((id) => id > 0)),
  );
  const items = (Zotero.Items.get(uniqueIDs) || []).filter(
    (item: any) => !!item && !item.deleted,
  );
  const rows = items.map((item: any) => ({
    itemID: Number(item.id) || -1,
    title: String(item.getField("title") || "").trim() || `#${item.id}`,
    year: parseYear(item.getField("date")),
  }));
  rows.sort((left, right) => {
    const leftYear = Number(left.year) || 0;
    const rightYear = Number(right.year) || 0;
    if (leftYear !== rightYear) {
      return rightYear - leftYear;
    }
    return left.title.localeCompare(right.title);
  });
  return rows.slice(0, Math.max(1, limit));
}

function parseYear(value: any) {
  const text = String(value || "");
  const match = text.match(/(\d{4})/);
  return match ? match[1] : "";
}

function formatCreatorFullName(firstName: string, lastName: string) {
  return `${(firstName || "").trim()} ${(lastName || "").trim()}`.trim();
}

function openItemInMainWindow(itemID: number) {
  const mainWindow = Zotero.getMainWindow() as any;
  const pane = mainWindow?.ZoteroPane;
  if (pane && typeof pane.selectItem === "function") {
    Promise.resolve(pane.selectItem(itemID)).catch((error) => {
      ztoolkit.log?.(
        `[AuthorBrowser] selectItem failed for ${itemID}: ${String(error)}`,
      );
    });
    mainWindow?.focus?.();
    return;
  }
  const item = Zotero.Items.get(itemID);
  if (item && typeof item.openDetailWindow === "function") {
    item.openDetailWindow();
  }
}

function getPromptParentWindow() {
  if (isWindowAlive(addon.data.manager.window)) {
    return addon.data.manager.window;
  }
  return Zotero.getMainWindow();
}

function resolveLiveMergeTargets(group: {
  targetMainID: number;
  candidateMainIDs: number[];
}) {
  const targetMainID = resolveMainID(group.targetMainID);
  const candidateMainIDs = Array.from(
    new Set(group.candidateMainIDs.map((id) => resolveMainID(id))),
  ).filter((id) => id > 0 && id !== targetMainID);
  return {
    targetMainID,
    candidateMainIDs,
  };
}

function resolveLiveAmbiguousTargets(group: BulkMergeAmbiguousPlan) {
  const abbrevMainID = resolveMainID(group.abbrevMainID);
  const candidateMainIDs = Array.from(
    new Set(group.candidateMainIDs.map((id) => resolveMainID(id))),
  ).filter((id) => id > 0 && id !== abbrevMainID);
  return {
    abbrevMainID,
    candidateMainIDs,
  };
}

async function executeBatchMergeGroup(
  report: BulkMergeReport,
  group: {
    phase: BulkMergePhase;
    targetMainID: number;
    candidateMainIDs: number[];
  },
  decision: BulkMergeDecision,
  reason: string,
) {
  const { targetMainID, candidateMainIDs: uniqueCandidateMainIDs } =
    resolveLiveMergeTargets(group);

  if (targetMainID <= 0 || uniqueCandidateMainIDs.length === 0) {
    appendBatchMergeEntry(report, {
      phase: group.phase,
      targetMainID: targetMainID > 0 ? targetMainID : group.targetMainID,
      candidateMainIDs: uniqueCandidateMainIDs,
      decision: "skipped",
      reason,
      addedAliasCount: 0,
      mergedGroupCount: 0,
      skippedCount: uniqueCandidateMainIDs.length,
      conflictCount: 0,
    });
    return;
  }

  if (
    decision === "skipped" ||
    decision === "manual-no" ||
    decision === "manual-all-no" ||
    decision === "ambiguous-skipped"
  ) {
    appendBatchMergeEntry(report, {
      phase: group.phase,
      targetMainID,
      candidateMainIDs: uniqueCandidateMainIDs,
      decision,
      reason,
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

  appendBatchMergeEntry(report, {
    phase: group.phase,
    targetMainID,
    candidateMainIDs: uniqueCandidateMainIDs,
    decision,
    reason,
    addedAliasCount: result.addedAliasIDs.length,
    mergedGroupCount: result.mergedGroupMainIDs.length,
    skippedCount: result.skippedAliasIDs.length,
    conflictCount: result.conflictAliasIDs.length,
  });
}

async function executeAmbiguousSelectedMerge(
  report: BulkMergeReport,
  abbrevMainID: number,
  selectedCandidateMainID: number,
  reason: string,
) {
  await executeBatchMergeGroup(
    report,
    {
      phase: "phase2-ambiguous",
      targetMainID: selectedCandidateMainID,
      candidateMainIDs: [abbrevMainID],
    },
    "ambiguous-selected",
    reason,
  );
}

function recordAmbiguousSkip(
  report: BulkMergeReport,
  abbrevMainID: number,
  candidateMainIDs: number[],
  reason: string,
) {
  const uniqueCandidateMainIDs = Array.from(
    new Set(candidateMainIDs.map((id) => resolveMainID(id))),
  ).filter((id) => id > 0);
  appendBatchMergeEntry(report, {
    phase: "phase2-ambiguous",
    targetMainID: resolveMainID(abbrevMainID) || abbrevMainID,
    candidateMainIDs: uniqueCandidateMainIDs,
    decision: "ambiguous-skipped",
    reason,
    addedAliasCount: 0,
    mergedGroupCount: 0,
    skippedCount: uniqueCandidateMainIDs.length > 0 ? 1 : 0,
    conflictCount: 0,
  });
}

function appendBatchMergeEntry(
  report: BulkMergeReport,
  entry: {
    phase: BulkMergePhase;
    targetMainID: number;
    candidateMainIDs: number[];
    decision: BulkMergeDecision;
    reason: string;
    addedAliasCount: number;
    mergedGroupCount: number;
    skippedCount: number;
    conflictCount: number;
  },
) {
  report.addedAliasCount += entry.addedAliasCount;
  report.mergedGroupCount += entry.mergedGroupCount;
  report.skippedCount += entry.skippedCount;
  report.conflictCount += entry.conflictCount;
  report.entries.push({
    phase: entry.phase,
    targetMainID: entry.targetMainID,
    targetMainName: getCreatorLabel(entry.targetMainID),
    candidateMainIDs: entry.candidateMainIDs,
    candidateMainNames: entry.candidateMainIDs.map((id) => getCreatorLabel(id)),
    decision: entry.decision,
    reason: entry.reason,
    addedAliasCount: entry.addedAliasCount,
    mergedGroupCount: entry.mergedGroupCount,
    skippedCount: entry.skippedCount,
    conflictCount: entry.conflictCount,
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
  lines.push(
    getString("bulk-merge-details-counts", {
      args: {
        phase1a: report.phase1NormalizedCount,
        phase1b: report.phase1AbbrevCount,
        phase2a: report.phase2AmbiguousCount,
        phase2b: report.phase2ManualCount,
      },
    }),
  );
  lines.push("");

  appendEntriesByPhase(
    lines,
    report.entries,
    "phase1-normalized",
    getString("bulk-merge-details-phase1a"),
  );
  lines.push("");
  appendEntriesByPhase(
    lines,
    report.entries,
    "phase1-abbrev",
    getString("bulk-merge-details-phase1b"),
  );
  lines.push("");
  appendEntriesByPhase(
    lines,
    report.entries,
    "phase2-ambiguous",
    getString("bulk-merge-details-phase2a"),
  );
  lines.push("");
  appendEntriesByPhase(
    lines,
    report.entries,
    "phase2-manual",
    getString("bulk-merge-details-phase2b"),
  );

  return lines.join("\n");
}

function appendEntriesByPhase(
  lines: string[],
  entries: BulkMergeDetailEntry[],
  phase: BulkMergePhase,
  title: string,
) {
  lines.push(title);
  const phaseEntries = entries.filter((entry) => entry.phase === phase);
  if (phaseEntries.length === 0) {
    lines.push(`  ${getString("bulk-merge-details-none")}`);
    return;
  }
  for (const entry of phaseEntries) {
    lines.push(`  ${formatBatchMergeReportEntry(entry)}`);
  }
}

function formatBatchMergeReportEntry(entry: BulkMergeDetailEntry) {
  const decisionLabel = getBatchMergeDecisionLabel(entry.decision);
  const candidates =
    entry.candidateMainNames.length > 0
      ? entry.candidateMainNames.join(", ")
      : getString("bulk-merge-details-none");
  return (
    `${entry.targetMainName} <- ${candidates} | ` +
    `${getString("bulk-merge-details-reason-label")}: ${entry.reason} | ` +
    `${getString("bulk-merge-details-decision-label")}: ${decisionLabel} | ` +
    `${getString("bulk-merge-details-added-label")}: ${entry.addedAliasCount} | ` +
    `${getString("bulk-merge-details-merged-groups-label")}: ${entry.mergedGroupCount} | ` +
    `${getString("bulk-merge-details-skipped-label")}: ${entry.skippedCount} | ` +
    `${getString("bulk-merge-details-conflict-label")}: ${entry.conflictCount}`
  );
}

function getBatchMergeDecisionLabel(decision: BulkMergeDecision) {
  if (decision === "auto-normalized") {
    return getString("bulk-merge-details-decision-auto-normalized");
  }
  if (decision === "auto-abbrev") {
    return getString("bulk-merge-details-decision-auto-abbrev");
  }
  if (decision === "manual-yes") {
    return getString("bulk-merge-details-decision-manual-yes");
  }
  if (decision === "manual-all-yes") {
    return getString("bulk-merge-details-decision-manual-all-yes");
  }
  if (decision === "manual-no") {
    return getString("bulk-merge-details-decision-manual-no");
  }
  if (decision === "manual-all-no") {
    return getString("bulk-merge-details-decision-manual-all-no");
  }
  if (decision === "ambiguous-selected") {
    return getString("bulk-merge-details-decision-ambiguous-selected");
  }
  if (decision === "ambiguous-skipped") {
    return getString("bulk-merge-details-decision-ambiguous-skipped");
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
