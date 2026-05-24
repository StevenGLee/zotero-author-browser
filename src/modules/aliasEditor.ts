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
  hasAliasGroup,
  resolveMainID,
} from "./authorBrowserAddon";
import { getCreatorNameMatchType } from "./authorNameMatch";

interface SuggestedAliasRow {
  creatorID: number;
  firstName: string;
  lastName: string;
  itemCount: number;
  matchReason: string;
  status: string;
  mergeSourceMainID: number;
}

interface AliasMemberRow {
  creatorID: number;
  firstName: string;
  lastName: string;
  itemCount: number;
}

interface AliasEditorSession {
  mainID: number;
  window?: Window;
  suggestedTableHelper?: any;
  currentAliasTableHelper?: any;
  allCreatorStats: CreatorStatDataRow[];
  suggestedRows: SuggestedAliasRow[];
  currentAliasRows: AliasMemberRow[];
  message: string;
  refreshing: boolean;
}

const sessionsByMainID = new Map<number, AliasEditorSession>();

export async function onDialog(mainCreatorID: number) {
  const resolvedMainID = resolveMainID(mainCreatorID);
  if (resolvedMainID <= 0) {
    return;
  }

  const existingSession = sessionsByMainID.get(resolvedMainID);
  if (existingSession && isWindowAlive(existingSession.window)) {
    existingSession.window?.focus();
    await refreshSession(existingSession);
    return;
  }

  const session: AliasEditorSession = {
    mainID: resolvedMainID,
    allCreatorStats: [],
    suggestedRows: [],
    currentAliasRows: [],
    message: "",
    refreshing: false,
  };
  sessionsByMainID.set(resolvedMainID, session);

  const windowArgs = {
    _initPromise: Zotero.Promise.defer(),
  };
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/AliasEditor.xhtml`,
    `${config.addonRef}-aliasEditor-${resolvedMainID}`,
    `chrome,centerscreen,resizable,status,dialog=yes`,
    windowArgs,
  )!;
  await windowArgs._initPromise.promise;
  session.window = win;

  bindWindowLifecycle(session);
  session.suggestedTableHelper = createSuggestedTable(session, win);
  session.currentAliasTableHelper = createCurrentAliasTable(session, win);
  bindButtons(session);

  await refreshSession(session);
}

export async function refreshAllOpenAliasManagers() {
  for (const [mainID, session] of sessionsByMainID) {
    if (!isWindowAlive(session.window)) {
      sessionsByMainID.delete(mainID);
      continue;
    }
    try {
      await refreshSession(session);
    } catch (error) {
      ztoolkit.log?.(
        `[AliasManager] Failed to refresh session ${mainID}: ${String(error)}`,
      );
    }
  }
}

function bindWindowLifecycle(session: AliasEditorSession) {
  session.window?.addEventListener("unload", () => {
    sessionsByMainID.delete(session.mainID);
  });
}

function createSuggestedTable(session: AliasEditorSession, win: Window) {
  return new ztoolkit.VirtualizedTable(win)
    .setContainerId("suggested-table-container")
    .setProp({
      id: "alias-editor-suggested-list",
      columns: [
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
          dataKey: "matchReason",
          label: getString("alias-editor-column-match-reason"),
          fixedWidth: false,
        },
        {
          dataKey: "status",
          label: getString("alias-editor-column-status"),
          fixedWidth: false,
        },
      ].map((column) =>
        Object.assign(column, {
          label:
            column.label === "firstName" ||
            column.label === "lastName" ||
            column.label === "itemCount"
              ? getString(column.label)
              : column.label,
        }),
      ),
      showHeader: true,
      multiSelect: true,
      staticColumns: false,
      disableFontSizeScaling: true,
    })
    .setProp("getRowCount", () => session.suggestedRows.length)
    .setProp("getRowData", (index) => {
      const row = session.suggestedRows[index];
      return {
        firstName: row.firstName,
        lastName: row.lastName,
        itemCount: String(row.itemCount),
        matchReason: row.matchReason,
        status: row.status,
      };
    })
    .setProp("onSelectionChange", () => {
      updateButtons(session);
    })
    .render();
}

function createCurrentAliasTable(session: AliasEditorSession, win: Window) {
  return new ztoolkit.VirtualizedTable(win)
    .setContainerId("current-alias-table-container")
    .setProp({
      id: "alias-editor-current-list",
      columns: [
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
      ].map((column) =>
        Object.assign(column, {
          label: getString(column.label),
        }),
      ),
      showHeader: true,
      multiSelect: true,
      staticColumns: false,
      disableFontSizeScaling: true,
    })
    .setProp("getRowCount", () => session.currentAliasRows.length)
    .setProp("getRowData", (index) => {
      const row = session.currentAliasRows[index];
      return {
        firstName: row.firstName,
        lastName: row.lastName,
        itemCount: String(row.itemCount),
      };
    })
    .setProp("onSelectionChange", () => {
      updateButtons(session);
    })
    .render();
}

function bindButtons(session: AliasEditorSession) {
  const win = session.window;
  if (!win) {
    return;
  }
  const addSelectedButton = win.document.querySelector(
    "#add-selected-suggestions",
  ) as HTMLButtonElement;
  const addAllButton = win.document.querySelector(
    "#add-all-suggestions",
  ) as HTMLButtonElement;
  const addBrowserButton = win.document.querySelector(
    "#add-browser-selection",
  ) as HTMLButtonElement;
  const restoreButton = win.document.querySelector(
    "#restore-selected-aliases",
  ) as HTMLButtonElement;
  const refreshButton = win.document.querySelector(
    "#refresh",
  ) as HTMLButtonElement;
  const closeButton = win.document.querySelector("#close") as HTMLButtonElement;

  addSelectedButton.addEventListener("click", async () => {
    const selectedRows = getSelectedRows(
      session.suggestedTableHelper,
      session.suggestedRows,
    );
    await addCreatorIDsToCurrentMain(
      session,
      selectedRows.map((row) => row.creatorID),
    );
  });

  addAllButton.addEventListener("click", async () => {
    await addCreatorIDsToCurrentMain(
      session,
      session.suggestedRows.map((row) => row.creatorID),
    );
  });

  addBrowserButton.addEventListener("click", async () => {
    const creatorID = await getAuthorBrowserSelectedCreatorID();
    if (creatorID <= 0) {
      setMessage(session, getString("alias-editor-msg-no-browser-selection"));
      return;
    }
    await addCreatorIDsToCurrentMain(session, [creatorID]);
  });

  restoreButton.addEventListener("click", async () => {
    await restoreSelectedAliases(session);
  });

  refreshButton.addEventListener("click", async () => {
    await refreshSession(session);
    setMessage(session, "");
  });

  closeButton.addEventListener("click", () => {
    win.close();
  });
}

async function refreshSession(session: AliasEditorSession) {
  if (session.refreshing) {
    return;
  }
  const win = session.window;
  if (!isWindowAlive(win)) {
    sessionsByMainID.delete(session.mainID);
    return;
  }

  session.refreshing = true;
  try {
    const resolvedMainID = resolveMainID(session.mainID);
    if (resolvedMainID <= 0) {
      return;
    }
    if (resolvedMainID !== session.mainID) {
      sessionsByMainID.delete(session.mainID);
      const existing = sessionsByMainID.get(resolvedMainID);
      if (existing && existing !== session && isWindowAlive(existing.window)) {
        win?.close();
        return;
      }
      session.mainID = resolvedMainID;
      sessionsByMainID.set(session.mainID, session);
    }

    session.allCreatorStats = await getAllCreatorStats("itemCount", true);
    const statMap = new Map<number, CreatorStatDataRow>();
    for (const row of session.allCreatorStats) {
      statMap.set(row.creatorID, row);
    }

    updateCurrentMainDisplay(session);
    updateCurrentAliasRows(session, statMap);
    updateSuggestedRows(session, statMap);

    await Promise.all([
      renderTable(session.suggestedTableHelper),
      renderTable(session.currentAliasTableHelper),
    ]);
    clearSelection(session.suggestedTableHelper);
    clearSelection(session.currentAliasTableHelper);
    updateButtons(session);
  } finally {
    session.refreshing = false;
  }
}

function updateCurrentMainDisplay(session: AliasEditorSession) {
  const win = session.window;
  if (!win) {
    return;
  }
  const creator = Zotero.Creators.get(session.mainID);
  const displayName = creator
    ? `${(creator.firstName || "").trim()} ${(creator.lastName || "").trim()}`.trim()
    : String(session.mainID);
  const mainNode = win.document.querySelector("#current-main-name") as HTMLElement;
  if (mainNode) {
    mainNode.textContent = `${displayName} (ID: ${session.mainID})`;
  }
}

function updateCurrentAliasRows(
  session: AliasEditorSession,
  statMap: Map<number, CreatorStatDataRow>,
) {
  const aliasIDs = getAllAliasByMainID(session.mainID);
  session.currentAliasRows = aliasIDs
    .map((aliasID) => toAliasMemberRow(aliasID, statMap))
    .filter((row) => !!row)
    .sort((a, b) => {
      const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
      const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
}

function updateSuggestedRows(
  session: AliasEditorSession,
  statMap: Map<number, CreatorStatDataRow>,
) {
  const currentAliasIDSet = new Set(session.currentAliasRows.map((row) => row.creatorID));
  const mainCreator =
    statMap.get(session.mainID) || toCreatorStatDataRow(session.mainID);
  if (!mainCreator) {
    session.suggestedRows = [];
    return;
  }

  const rows: SuggestedAliasRow[] = [];
  for (const candidate of session.allCreatorStats) {
    if (candidate.creatorID === session.mainID) {
      continue;
    }
    if (currentAliasIDSet.has(candidate.creatorID)) {
      continue;
    }
    const match = getSuggestionMatch(mainCreator, candidate);
    if (!match) {
      continue;
    }
    const mergeSourceMainID = getMergeSourceMainID(session.mainID, candidate.creatorID);
    rows.push({
      creatorID: candidate.creatorID,
      firstName: candidate.firstName || "",
      lastName: candidate.lastName || "",
      itemCount: Number(candidate.itemCount) || 0,
      matchReason: match.reason,
      status:
        mergeSourceMainID > 0
          ? `${getString("alias-editor-status-needs-merge")} ${getCreatorDisplayName(mergeSourceMainID)}`
          : getString("alias-editor-status-ready"),
      mergeSourceMainID,
    });
  }

  session.suggestedRows = rows.sort((a, b) => {
    const needsMergeA = a.mergeSourceMainID > 0 ? 1 : 0;
    const needsMergeB = b.mergeSourceMainID > 0 ? 1 : 0;
    if (needsMergeA !== needsMergeB) {
      return needsMergeA - needsMergeB;
    }
    if (a.itemCount !== b.itemCount) {
      return b.itemCount - a.itemCount;
    }
    const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
    const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function toAliasMemberRow(
  creatorID: number,
  statMap: Map<number, CreatorStatDataRow>,
): AliasMemberRow | undefined {
  const statRow = statMap.get(creatorID) || toCreatorStatDataRow(creatorID);
  if (!statRow) {
    return undefined;
  }
  return {
    creatorID: statRow.creatorID,
    firstName: statRow.firstName || "",
    lastName: statRow.lastName || "",
    itemCount: Number(statRow.itemCount) || 0,
  };
}

function toCreatorStatDataRow(creatorID: number): CreatorStatDataRow | undefined {
  if (creatorID <= 0) {
    return undefined;
  }
  const creator = Zotero.Creators.get(creatorID);
  if (!creator) {
    return undefined;
  }
  return {
    creatorID,
    firstName: creator.firstName || "",
    lastName: creator.lastName || "",
    itemCount: 0,
  };
}

function getSuggestionMatch(
  mainCreator: CreatorStatDataRow,
  candidate: CreatorStatDataRow,
) {
  const matchType = getCreatorNameMatchType(mainCreator, candidate);
  if (matchType === "normalized-full-name") {
    return { reason: getString("alias-editor-match-normalized"), priority: 0 };
  }
  if (matchType === "abbrev-high-confidence") {
    return { reason: getString("alias-editor-match-abbrev"), priority: 1 };
  }
  if (matchType === "same-last-name-initial-manual") {
    return { reason: getString("alias-editor-match-initial"), priority: 2 };
  }
  return null;
}

function getMergeSourceMainID(currentMainID: number, candidateID: number) {
  const candidateMainID = resolveMainID(candidateID);
  if (candidateMainID === currentMainID) {
    return -1;
  }
  if (candidateMainID !== candidateID) {
    return candidateMainID;
  }
  if (hasAliasGroup(candidateID)) {
    return candidateID;
  }
  return -1;
}

async function addCreatorIDsToCurrentMain(
  session: AliasEditorSession,
  rawCreatorIDs: number[],
) {
  if (session.mainID <= 0) {
    setMessage(session, getString("alias-editor-msg-no-main"));
    return;
  }
  const creatorIDs = Array.from(
    new Set((rawCreatorIDs || []).map((id) => Number(id))),
  ).filter((id) => id > 0);
  if (creatorIDs.length === 0) {
    setMessage(session, getString("alias-editor-msg-no-selection"));
    return;
  }

  const mergeMainIDSet = new Set<number>();
  for (const creatorID of creatorIDs) {
    const mergeSourceMainID = getMergeSourceMainID(session.mainID, creatorID);
    if (mergeSourceMainID > 0) {
      mergeMainIDSet.add(mergeSourceMainID);
    }
  }

  if (mergeMainIDSet.size > 0) {
    const mergeMainIDs = Array.from(mergeMainIDSet);
    const mergeCreatorCount = mergeMainIDs.reduce(
      (count, mainID) => count + expandGroupForMerge(mainID).length,
      0,
    );
    const previewNames = mergeMainIDs
      .slice(0, 3)
      .map((id) => getCreatorDisplayName(id))
      .join(", ");
    const suffixText =
      mergeMainIDs.length > 3
        ? ` ${getString("alias-editor-merge-preview-more")}`
        : "";
    const confirmText =
      `${getString("alias-editor-confirm-merge-prefix")} ${mergeCreatorCount} ` +
      `${getString("alias-editor-confirm-merge-suffix")}\n` +
      `${previewNames}${suffixText}`;
    if (!session.window?.confirm(confirmText)) {
      setMessage(session, getString("alias-editor-msg-merge-cancelled"));
      return;
    }
  }

  const result = await applyAliasMutation({
    type: "add",
    mainID: session.mainID,
    creatorIDs,
    mergeGroups: mergeMainIDSet.size > 0,
  });
  await postMutationRefresh(session);
  setMessageFromMutationResult(session, result);
}

async function restoreSelectedAliases(session: AliasEditorSession) {
  if (session.mainID <= 0) {
    setMessage(session, getString("alias-editor-msg-no-main"));
    return;
  }
  const selectedRows = getSelectedRows(
    session.currentAliasTableHelper,
    session.currentAliasRows,
  );
  if (selectedRows.length === 0) {
    setMessage(session, getString("alias-editor-msg-no-selection"));
    return;
  }

  const result = await applyAliasMutation({
    type: "remove",
    mainID: session.mainID,
    creatorIDs: selectedRows.map((row) => row.creatorID),
  });
  await postMutationRefresh(session);
  setMessageFromMutationResult(session, result);
}

async function postMutationRefresh(session: AliasEditorSession) {
  await refreshSession(session);
  await refreshAuthorBrowserWindow();
  for (const [mainID, targetSession] of sessionsByMainID) {
    if (targetSession === session) {
      continue;
    }
    if (!isWindowAlive(targetSession.window)) {
      sessionsByMainID.delete(mainID);
      continue;
    }
    try {
      await refreshSession(targetSession);
    } catch (error) {
      ztoolkit.log?.(
        `[AliasManager] Failed to refresh peer session ${mainID}: ${String(error)}`,
      );
    }
  }
}

function renderTable(tableHelper: any) {
  return new Promise<void>((resolve) => {
    if (!tableHelper) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    try {
      tableHelper.render(undefined, () => done());
    } catch (error) {
      ztoolkit.log?.(
        `[AliasManager] render failed: ${String(error)}`,
      );
      done();
      return;
    }
    setTimeout(() => done(), 50);
  });
}

function clearSelection(tableHelper: any) {
  const selection = tableHelper?.treeInstance?.selection;
  if (!selection) {
    return;
  }
  if (typeof selection.clearSelection === "function") {
    selection.clearSelection();
    return;
  }
  if (selection.selected && typeof selection.selected.clear === "function") {
    selection.selected.clear();
  }
}

function getSelectedRows<T extends { creatorID: number }>(
  tableHelper: any,
  rows: T[],
) {
  const selected: T[] = [];
  const indices = getSelectedIndices(tableHelper);
  for (const idx of indices) {
    if (idx >= 0 && idx < rows.length) {
      selected.push(rows[idx]);
    }
  }
  return selected;
}

function getSelectedIndices(tableHelper: any): number[] {
  const selectedRaw = tableHelper?.treeInstance?.selection?.selected;
  if (!selectedRaw) {
    return [];
  }
  try {
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
  } catch (error) {
    ztoolkit.log?.(`[AliasManager] Failed to read selection: ${String(error)}`);
  }
  return [];
}

function setMessage(session: AliasEditorSession, message: string) {
  session.message = message;
  const messageNode = session.window?.document.querySelector(
    "#action-message",
  ) as HTMLElement;
  if (messageNode) {
    messageNode.textContent = message || "";
  }
}

function setMessageFromMutationResult(
  session: AliasEditorSession,
  result: {
    addedAliasIDs: number[];
    removedAliasIDs: number[];
    conflictAliasIDs: number[];
    skippedAliasIDs: number[];
    mergedGroupMainIDs: number[];
  },
) {
  const messageParts: string[] = [];
  if (result.addedAliasIDs.length > 0) {
    messageParts.push(
      `${getString("alias-editor-msg-added")} ${result.addedAliasIDs.length}`,
    );
  }
  if (result.removedAliasIDs.length > 0) {
    messageParts.push(
      `${getString("alias-editor-msg-restored")} ${result.removedAliasIDs.length}`,
    );
  }
  if (result.mergedGroupMainIDs.length > 0) {
    messageParts.push(
      `${getString("alias-editor-msg-merged-groups")} ${result.mergedGroupMainIDs.length}`,
    );
  }
  if (result.conflictAliasIDs.length > 0) {
    messageParts.push(
      `${getString("alias-editor-msg-conflict")} ${result.conflictAliasIDs.length}`,
    );
  }
  if (result.skippedAliasIDs.length > 0) {
    messageParts.push(
      `${getString("alias-editor-msg-skipped")} ${result.skippedAliasIDs.length}`,
    );
  }
  if (messageParts.length === 0) {
    messageParts.push(getString("alias-editor-msg-no-changes"));
  }
  setMessage(session, messageParts.join(" | "));
}

function updateButtons(session: AliasEditorSession) {
  const win = session.window;
  if (!win) {
    return;
  }

  const addSelectedButton = win.document.querySelector(
    "#add-selected-suggestions",
  ) as HTMLButtonElement;
  const addAllButton = win.document.querySelector(
    "#add-all-suggestions",
  ) as HTMLButtonElement;
  const addBrowserButton = win.document.querySelector(
    "#add-browser-selection",
  ) as HTMLButtonElement;
  const restoreButton = win.document.querySelector(
    "#restore-selected-aliases",
  ) as HTMLButtonElement;

  const selectedSuggestedRows = getSelectedRows(
    session.suggestedTableHelper,
    session.suggestedRows,
  );
  const selectedAliasRows = getSelectedRows(
    session.currentAliasTableHelper,
    session.currentAliasRows,
  );
  const hasMain = session.mainID > 0;

  addSelectedButton.disabled = !hasMain || selectedSuggestedRows.length === 0;
  addAllButton.disabled = !hasMain || session.suggestedRows.length === 0;
  addBrowserButton.disabled = !hasMain;
  restoreButton.disabled = !hasMain || selectedAliasRows.length === 0;
}

function getCreatorDisplayName(creatorID: number) {
  const creator = Zotero.Creators.get(creatorID);
  if (!creator) {
    return String(creatorID);
  }
  const firstName = (creator.firstName || "").trim();
  const lastName = (creator.lastName || "").trim();
  return `${firstName} ${lastName}`.trim();
}

async function getAuthorBrowserSelectedCreatorID() {
  const module = await import("./authorBrowserDialog");
  if (module && typeof module.getCurrentSelectedCreatorID === "function") {
    return module.getCurrentSelectedCreatorID();
  }
  return -1;
}

async function refreshAuthorBrowserWindow() {
  const module = await import("./authorBrowserDialog");
  if (module && typeof module.refreshIfOpen === "function") {
    await module.refreshIfOpen();
  }
}
