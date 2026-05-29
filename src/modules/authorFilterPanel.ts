/// @ts-nocheck
import { getString } from "../utils/locale";
import { getAllAliasByMainID, readCreatorAlias, resolveMainID } from "./authorBrowserAddon";

type AuthorFilterScopeMode = "current-view" | "current-library";
type AuthorFilterCompositionMode = "stacked" | "exclusive";
type AuthorFilterMatchMode = "or" | "and";

interface AuthorFilterOption {
  mainID: number;
  displayName: string;
  itemCount: number;
}

interface AuthorFilterState {
  win: Window;
  root?: HTMLDivElement;
  searchInput?: HTMLInputElement;
  scopeSelect?: HTMLSelectElement;
  compositionSelect?: HTMLSelectElement;
  matchSelect?: HTMLSelectElement;
  includeAliasesInput?: HTMLInputElement;
  listContainer?: HTMLDivElement;
  statusNode?: HTMLDivElement;
  scopeMode: AuthorFilterScopeMode;
  compositionMode: AuthorFilterCompositionMode;
  matchMode: AuthorFilterMatchMode;
  includeAliases: boolean;
  selectedMainCreatorIDs: Set<number>;
  options: AuthorFilterOption[];
  searchKeyword: string;
  active: boolean;
  refreshToken: number;
  destroyed: boolean;
  syncTimer?: number;
  lastCollectionTreeRowID?: string;
}

const AUTHOR_FILTER_PANEL_ID = "author-browser-author-filter-panel";
const AUTHOR_FILTER_LIST_ID = "author-browser-author-filter-list";
const AUTHOR_FILTER_SCOPE_SELECT_ID = "author-browser-author-filter-scope";
const AUTHOR_FILTER_COMPOSITION_SELECT_ID =
  "author-browser-author-filter-composition";
const AUTHOR_FILTER_MATCH_SELECT_ID = "author-browser-author-filter-match";
const AUTHOR_FILTER_SEARCH_INPUT_ID = "author-browser-author-filter-search";
const AUTHOR_FILTER_INCLUDE_ALIAS_ID = "author-browser-author-filter-include-alias";
const AUTHOR_FILTER_STATUS_ID = "author-browser-author-filter-status";
const AUTHOR_STAT_CREATOR_TYPE_IDS_SQL = "8, 24, 15";

const panelStateByWindow = new Map<Window, AuthorFilterState>();

function createDefaultState(win: Window): AuthorFilterState {
  return {
    win,
    scopeMode: "current-view",
    compositionMode: "stacked",
    matchMode: "or",
    includeAliases: true,
    selectedMainCreatorIDs: new Set<number>(),
    options: [],
    searchKeyword: "",
    active: false,
    refreshToken: 0,
    destroyed: false,
    lastCollectionTreeRowID: getCurrentCollectionTreeRowID(),
  };
}

function getPanelState(win?: Window) {
  if (win && panelStateByWindow.has(win)) {
    return panelStateByWindow.get(win)!;
  }
  const mainWindow = (Zotero.getMainWindow?.() || win || window) as Window;
  if (panelStateByWindow.has(mainWindow)) {
    return panelStateByWindow.get(mainWindow)!;
  }
  return undefined;
}

export async function initAuthorFilterPanel(win: Window) {
  if (!win || panelStateByWindow.has(win)) {
    return;
  }
  const state = createDefaultState(win);
  panelStateByWindow.set(win, state);
  await readCreatorAlias().catch(() => undefined);
  await mountPanelWithRetry(state);
  startSyncTimer(state);
  await refreshAuthorFilterOptions(state, {
    applyFilter: false,
  });
}

export function destroyAuthorFilterPanel(win?: Window) {
  const state = getPanelState(win);
  if (!state) {
    return;
  }
  state.destroyed = true;
  if (state.syncTimer) {
    state.win.clearInterval(state.syncTimer);
    state.syncTimer = undefined;
  }
  if (state.root?.parentNode) {
    state.root.parentNode.removeChild(state.root);
  }
  panelStateByWindow.delete(state.win);
}

export async function activateAuthorFilterByCreatorID(creatorID: number) {
  const state = getPanelState();
  if (!state || state.destroyed) {
    return false;
  }
  await readCreatorAlias().catch(() => undefined);
  const mainID = resolveMainID(Number(creatorID));
  if (!(mainID > 0)) {
    return false;
  }
  state.selectedMainCreatorIDs.add(mainID);
  state.active = state.selectedMainCreatorIDs.size > 0;
  if (state.includeAliasesInput) {
    state.includeAliases = !!state.includeAliasesInput.checked;
  }
  renderAuthorOptionList(state);
  await applyAuthorFilter(state);
  return true;
}

export async function clearAuthorFilter() {
  const state = getPanelState();
  if (!state || state.destroyed) {
    return false;
  }
  state.selectedMainCreatorIDs.clear();
  state.active = false;
  renderAuthorOptionList(state);
  await restoreSelectedCollectionView();
  updateStatus(state);
  return true;
}

export async function refreshAuthorFilterIfOpen() {
  const state = getPanelState();
  if (!state || state.destroyed) {
    return;
  }
  await readCreatorAlias().catch(() => undefined);
  await refreshAuthorFilterOptions(state, {
    applyFilter: state.active,
  });
}

async function mountPanelWithRetry(state: AuthorFilterState) {
  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (state.destroyed) {
      return;
    }
    const mounted = mountPanel(state);
    if (mounted) {
      return;
    }
    await new Promise((resolve) => state.win.setTimeout(resolve, 250));
  }
}

function mountPanel(state: AuthorFilterState) {
  const doc = state.win.document;
  const container = doc.getElementById("zotero-tag-selector-container");
  if (!container) {
    return false;
  }

  if (state.root?.parentNode) {
    return true;
  }

  const existing = doc.getElementById(AUTHOR_FILTER_PANEL_ID);
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const root = doc.createElement("div");
  root.id = AUTHOR_FILTER_PANEL_ID;
  root.className = "author-filter-panel";
  root.style.borderBottom = "1px solid var(--material-divider)";
  root.style.padding = "8px";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.gap = "6px";
  root.style.background = "var(--material-background)";

  const header = doc.createElement("div");
  header.textContent = getString("author-filter-title");
  header.style.fontWeight = "600";
  root.appendChild(header);

  const modeRow = doc.createElement("div");
  modeRow.style.display = "grid";
  modeRow.style.gridTemplateColumns = "1fr 1fr";
  modeRow.style.gap = "6px";

  const scopeSelect = doc.createElement("select");
  scopeSelect.id = AUTHOR_FILTER_SCOPE_SELECT_ID;
  scopeSelect.title = getString("author-filter-scope");
  appendSelectOptions(scopeSelect, [
    { value: "current-view", label: getString("author-filter-scope-current-view") },
    {
      value: "current-library",
      label: getString("author-filter-scope-current-library"),
    },
  ]);
  scopeSelect.value = state.scopeMode;
  scopeSelect.addEventListener("change", async () => {
    state.scopeMode = scopeSelect.value as AuthorFilterScopeMode;
    await refreshAuthorFilterOptions(state, {
      applyFilter: state.active,
    });
  });
  modeRow.appendChild(scopeSelect);

  const compositionSelect = doc.createElement("select");
  compositionSelect.id = AUTHOR_FILTER_COMPOSITION_SELECT_ID;
  compositionSelect.title = getString("author-filter-composition");
  appendSelectOptions(compositionSelect, [
    { value: "stacked", label: getString("author-filter-composition-stacked") },
    {
      value: "exclusive",
      label: getString("author-filter-composition-exclusive"),
    },
  ]);
  compositionSelect.value = state.compositionMode;
  compositionSelect.addEventListener("change", async () => {
    state.compositionMode = compositionSelect.value as AuthorFilterCompositionMode;
    await refreshAuthorFilterOptions(state, {
      applyFilter: state.active,
    });
  });
  modeRow.appendChild(compositionSelect);
  root.appendChild(modeRow);

  const matchRow = doc.createElement("div");
  matchRow.style.display = "grid";
  matchRow.style.gridTemplateColumns = "1fr auto";
  matchRow.style.gap = "6px";

  const matchSelect = doc.createElement("select");
  matchSelect.id = AUTHOR_FILTER_MATCH_SELECT_ID;
  matchSelect.title = getString("author-filter-match-mode");
  appendSelectOptions(matchSelect, [
    { value: "or", label: getString("author-filter-match-or") },
    { value: "and", label: getString("author-filter-match-and") },
  ]);
  matchSelect.value = state.matchMode;
  matchSelect.addEventListener("change", async () => {
    state.matchMode = matchSelect.value as AuthorFilterMatchMode;
    if (state.active) {
      await applyAuthorFilter(state);
    }
  });
  matchRow.appendChild(matchSelect);

  const aliasLabel = doc.createElement("label");
  aliasLabel.style.display = "inline-flex";
  aliasLabel.style.alignItems = "center";
  aliasLabel.style.gap = "4px";
  const includeAliasesInput = doc.createElement("input");
  includeAliasesInput.id = AUTHOR_FILTER_INCLUDE_ALIAS_ID;
  includeAliasesInput.type = "checkbox";
  includeAliasesInput.checked = state.includeAliases;
  includeAliasesInput.addEventListener("change", async () => {
    state.includeAliases = includeAliasesInput.checked;
    await refreshAuthorFilterOptions(state, {
      applyFilter: state.active,
    });
  });
  aliasLabel.appendChild(includeAliasesInput);
  const aliasText = doc.createElement("span");
  aliasText.textContent = getString("author-filter-include-aliases");
  aliasLabel.appendChild(aliasText);
  matchRow.appendChild(aliasLabel);
  root.appendChild(matchRow);

  const searchRow = doc.createElement("div");
  searchRow.style.display = "grid";
  searchRow.style.gridTemplateColumns = "1fr auto auto";
  searchRow.style.gap = "6px";

  const searchInput = doc.createElement("input");
  searchInput.id = AUTHOR_FILTER_SEARCH_INPUT_ID;
  searchInput.type = "search";
  searchInput.placeholder = getString("author-filter-search-placeholder");
  searchInput.value = state.searchKeyword;
  searchInput.addEventListener("input", () => {
    state.searchKeyword = searchInput.value || "";
    renderAuthorOptionList(state);
  });
  searchRow.appendChild(searchInput);

  const clearButton = doc.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = getString("author-filter-clear");
  clearButton.addEventListener("click", async () => {
    state.selectedMainCreatorIDs.clear();
    state.active = false;
    renderAuthorOptionList(state);
    await restoreSelectedCollectionView();
    updateStatus(state);
  });
  searchRow.appendChild(clearButton);

  const refreshButton = doc.createElement("button");
  refreshButton.type = "button";
  refreshButton.textContent = getString("author-filter-refresh");
  refreshButton.addEventListener("click", async () => {
    await refreshAuthorFilterOptions(state, {
      applyFilter: state.active,
    });
  });
  searchRow.appendChild(refreshButton);
  root.appendChild(searchRow);

  const listContainer = doc.createElement("div");
  listContainer.id = AUTHOR_FILTER_LIST_ID;
  listContainer.style.minHeight = "120px";
  listContainer.style.maxHeight = "220px";
  listContainer.style.overflow = "auto";
  listContainer.style.border = "1px solid var(--material-divider)";
  listContainer.style.borderRadius = "4px";
  listContainer.style.padding = "4px";
  root.appendChild(listContainer);

  const statusNode = doc.createElement("div");
  statusNode.id = AUTHOR_FILTER_STATUS_ID;
  statusNode.style.fontSize = "11px";
  statusNode.style.color = "var(--color-text-secondary)";
  root.appendChild(statusNode);

  const selectorNode = doc.getElementById("zotero-tag-selector");
  if (selectorNode && selectorNode.parentNode === container) {
    container.insertBefore(root, selectorNode);
  } else {
    container.prepend(root);
  }

  state.root = root;
  state.scopeSelect = scopeSelect;
  state.compositionSelect = compositionSelect;
  state.matchSelect = matchSelect;
  state.includeAliasesInput = includeAliasesInput;
  state.searchInput = searchInput;
  state.listContainer = listContainer;
  state.statusNode = statusNode;

  renderAuthorOptionList(state);
  updateStatus(state);
  return true;
}

function appendSelectOptions(
  selectNode: HTMLSelectElement,
  options: Array<{
    value: string;
    label: string;
  }>,
) {
  for (const option of options) {
    const node = selectNode.ownerDocument.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    selectNode.appendChild(node);
  }
}

async function refreshAuthorFilterOptions(
  state: AuthorFilterState,
  options: {
    applyFilter: boolean;
  },
) {
  if (state.destroyed) {
    return;
  }
  const token = ++state.refreshToken;
  const rows = await queryAuthorOptions(state);
  if (state.destroyed || token !== state.refreshToken) {
    return;
  }
  state.options = rows;

  const validMainIDs = new Set(rows.map((row) => row.mainID));
  state.selectedMainCreatorIDs = new Set(
    Array.from(state.selectedMainCreatorIDs).filter((id) => validMainIDs.has(id)),
  );
  state.active = state.selectedMainCreatorIDs.size > 0;

  renderAuthorOptionList(state);
  if (options.applyFilter && state.active) {
    await applyAuthorFilter(state);
  } else {
    updateStatus(state);
  }
}

async function queryAuthorOptions(state: AuthorFilterState) {
  const baseSearch = await buildBaseSearchForList(state);
  if (!baseSearch) {
    return [];
  }
  const tempTable = await baseSearch.search(true);
  if (!tempTable) {
    return [];
  }

  const sql =
    "SELECT creators.firstName, creators.lastName, creators.creatorID, COUNT(DISTINCT itemCreators.itemID) AS itemCount " +
    "FROM itemCreators " +
    "JOIN creators ON creators.creatorID = itemCreators.creatorID " +
    "JOIN " +
    tempTable +
    " ON " +
    tempTable +
    ".itemID = itemCreators.itemID " +
    "WHERE creators.fieldMode = 0 AND itemCreators.creatorTypeID IN (" +
    AUTHOR_STAT_CREATOR_TYPE_IDS_SQL +
    ") " +
    "GROUP BY itemCreators.creatorID";

  let rows: any[] = [];
  await Zotero.DB.executeTransaction(async function () {
    rows = (await Zotero.DB.queryAsync(sql)) || [];
    await Zotero.DB.queryAsync("DROP TABLE IF EXISTS " + tempTable).catch(() => {
      return undefined;
    });
  });

  const authorMap = new Map<number, AuthorFilterOption>();
  for (const row of rows) {
    const creatorID = Number(row.creatorID) || -1;
    if (!(creatorID > 0)) {
      continue;
    }
    const mainID = resolveMainID(creatorID);
    if (!(mainID > 0)) {
      continue;
    }
    const fullName = formatFullName(row.firstName || "", row.lastName || "");
    const displayName = fullName || `ID: ${creatorID}`;
    if (!authorMap.has(mainID)) {
      const creator = Zotero.Creators.get(mainID);
      const mainLabel = creator
        ? formatFullName(creator.firstName || "", creator.lastName || "") || `ID: ${mainID}`
        : displayName;
      authorMap.set(mainID, {
        mainID,
        displayName: mainLabel,
        itemCount: 0,
      });
    }
    const current = authorMap.get(mainID)!;
    current.itemCount += Number(row.itemCount) || 0;
  }

  const options = Array.from(authorMap.values());
  options.sort((left, right) => {
    const countDiff = right.itemCount - left.itemCount;
    if (countDiff !== 0) {
      return countDiff;
    }
    return left.displayName.localeCompare(right.displayName);
  });
  return options;
}

async function buildBaseSearchForList(state: AuthorFilterState) {
  const currentRow = getCurrentCollectionTreeRow();
  const libraryID = getCurrentLibraryID(currentRow);
  if (!(libraryID > 0)) {
    return undefined;
  }

  if (state.scopeMode === "current-library") {
    const s = new Zotero.Search({
      libraryID,
    });
    if (state.compositionMode === "stacked") {
      const sourceSearch = await getSearchObjectFromRow(currentRow);
      addInteractiveFilterConditions(s, sourceSearch);
    }
    return s;
  }

  const scopedSearch = await getSearchObjectFromRow(currentRow);
  if (!scopedSearch) {
    return new Zotero.Search({
      libraryID,
    });
  }
  if (state.compositionMode === "stacked") {
    return scopedSearch;
  }
  return cloneSearchWithoutInteractiveFilters(scopedSearch, libraryID);
}

async function applyAuthorFilter(state: AuthorFilterState) {
  if (state.destroyed) {
    return;
  }
  if (state.selectedMainCreatorIDs.size === 0) {
    state.active = false;
    await restoreSelectedCollectionView();
    updateStatus(state);
    return;
  }

  const groups = buildSelectedAuthorGroups(state);
  if (groups.length === 0) {
    state.active = false;
    await restoreSelectedCollectionView();
    updateStatus(state);
    return;
  }

  const baseSearch = await buildBaseSearchForFilter(state);
  if (!baseSearch) {
    return;
  }

  let itemIDs: number[] = [];
  if (state.matchMode === "or") {
    itemIDs = await queryORMatchItemIDs(baseSearch, groups);
  } else {
    itemIDs = await queryANDMatchItemIDs(baseSearch, groups);
  }

  await showFilteredItemsInItemsView(itemIDs);
  state.active = true;
  updateStatus(state, itemIDs.length);
}

function buildSelectedAuthorGroups(state: AuthorFilterState) {
  const groups: Array<{
    mainID: number;
    names: string[];
  }> = [];

  for (const mainID of Array.from(state.selectedMainCreatorIDs)) {
    const resolvedMainID = resolveMainID(mainID);
    if (!(resolvedMainID > 0)) {
      continue;
    }
    const nameSet = new Set<string>();
    const creator = Zotero.Creators.get(resolvedMainID);
    if (creator) {
      const fullName = formatFullName(creator.firstName || "", creator.lastName || "");
      if (fullName) {
        nameSet.add(fullName);
      }
    }

    if (state.includeAliases) {
      const aliasIDs = getAllAliasByMainID(resolvedMainID);
      for (const aliasID of aliasIDs) {
        const aliasCreator = Zotero.Creators.get(aliasID);
        if (!aliasCreator) {
          continue;
        }
        const aliasFullName = formatFullName(
          aliasCreator.firstName || "",
          aliasCreator.lastName || "",
        );
        if (aliasFullName) {
          nameSet.add(aliasFullName);
        }
      }
    }

    const names = Array.from(nameSet);
    if (names.length > 0) {
      groups.push({
        mainID: resolvedMainID,
        names,
      });
    }
  }

  return groups;
}

async function buildBaseSearchForFilter(state: AuthorFilterState) {
  const currentRow = getCurrentCollectionTreeRow();
  const libraryID = getCurrentLibraryID(currentRow);
  if (!(libraryID > 0)) {
    return undefined;
  }

  if (state.scopeMode === "current-library") {
    const search = new Zotero.Search({
      libraryID,
    });
    if (state.compositionMode === "stacked") {
      const sourceSearch = await getSearchObjectFromRow(currentRow);
      addInteractiveFilterConditions(search, sourceSearch);
    }
    return search;
  }

  const currentViewSearch = await getSearchObjectFromRow(currentRow);
  if (!currentViewSearch) {
    return new Zotero.Search({
      libraryID,
    });
  }
  if (state.compositionMode === "stacked") {
    return currentViewSearch;
  }
  return cloneSearchWithoutInteractiveFilters(currentViewSearch, libraryID);
}

async function queryORMatchItemIDs(
  baseSearch: Zotero.Search,
  groups: Array<{
    mainID: number;
    names: string[];
  }>,
) {
  const scopedSearch = new Zotero.Search({
    libraryID: Number(baseSearch.libraryID) || ZoteroPane.getSelectedLibraryID(),
  });
  scopedSearch.setScope(baseSearch, true);
  scopedSearch.addCondition("joinMode", "any");
  for (const group of groups) {
    for (const name of group.names) {
      scopedSearch.addCondition("creator", "is", name);
    }
  }
  return ((await scopedSearch.search()) || [])
    .map((id) => Number(id))
    .filter((id) => id > 0);
}

async function queryANDMatchItemIDs(
  baseSearch: Zotero.Search,
  groups: Array<{
    mainID: number;
    names: string[];
  }>,
) {
  let intersectionSet: Set<number> | undefined = undefined;
  let orderedIDs: number[] = [];

  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const scopedSearch = new Zotero.Search({
      libraryID: Number(baseSearch.libraryID) || ZoteroPane.getSelectedLibraryID(),
    });
    scopedSearch.setScope(baseSearch, true);
    scopedSearch.addCondition("joinMode", "any");
    for (const name of group.names) {
      scopedSearch.addCondition("creator", "is", name);
    }
    const ids = ((await scopedSearch.search()) || [])
      .map((id) => Number(id))
      .filter((id) => id > 0);
    const idSet = new Set(ids);

    if (!intersectionSet) {
      intersectionSet = idSet;
      orderedIDs = ids;
      continue;
    }

    intersectionSet = new Set(Array.from(intersectionSet).filter((id) => idSet.has(id)));
    orderedIDs = orderedIDs.filter((id) => intersectionSet?.has(id));

    if (intersectionSet.size === 0) {
      return [];
    }
  }

  return orderedIDs.filter((id) => intersectionSet?.has(id));
}

async function showFilteredItemsInItemsView(itemIDs: number[]) {
  const uniqueIDs = Array.from(
    new Set(itemIDs.map((id) => Number(id)).filter((id) => id > 0)),
  );
  const collectionTreeRow = {
    view: {},
    ref: {
      id: "author-browser-author-filter-temp",
    },
    id: "author-browser-author-filter-temp",
    visibilityGroup: "default",
    isSearchMode: () => true,
    getItems: async function () {
      return Zotero.Items.get(uniqueIDs);
    },
    isLibrary: () => false,
    isCollection: () => false,
    isSearch: () => true,
    isPublications: () => false,
    isDuplicates: () => false,
    isFeed: () => false,
    isFeeds: () => false,
    isFeedsOrFeed: () => false,
    isShare: () => false,
    isTrash: () => false,
  };
  if (ZoteroPane.itemsView) {
    await ZoteroPane.itemsView.changeCollectionTreeRow(collectionTreeRow);
  }
}

async function restoreSelectedCollectionView() {
  const row = getCurrentCollectionTreeRow();
  if (row && ZoteroPane?.itemsView) {
    await ZoteroPane.itemsView.changeCollectionTreeRow(row);
    if (ZoteroPane?.itemsView?.onRefresh?.notify) {
      ZoteroPane.itemsView.onRefresh.notify();
    }
    return;
  }
  if (ZoteroPane?.onCollectionSelected) {
    await ZoteroPane.onCollectionSelected();
  }
}

function renderAuthorOptionList(state: AuthorFilterState) {
  const container = state.listContainer;
  if (!container) {
    return;
  }
  container.textContent = "";
  const keyword = (state.searchKeyword || "").trim().toLowerCase();
  const rows =
    keyword.length === 0
      ? state.options
      : state.options.filter((row) => row.displayName.toLowerCase().includes(keyword));
  if (rows.length === 0) {
    const emptyNode = container.ownerDocument.createElement("div");
    emptyNode.style.padding = "6px";
    emptyNode.style.color = "var(--color-text-secondary)";
    emptyNode.textContent = getString("author-filter-empty");
    container.appendChild(emptyNode);
    updateStatus(state);
    return;
  }

  for (const row of rows) {
    const line = container.ownerDocument.createElement("label");
    line.style.display = "grid";
    line.style.gridTemplateColumns = "auto 1fr auto";
    line.style.gap = "6px";
    line.style.alignItems = "center";
    line.style.padding = "3px 4px";
    line.style.cursor = "pointer";

    const checkbox = container.ownerDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedMainCreatorIDs.has(row.mainID);
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        state.selectedMainCreatorIDs.add(row.mainID);
      } else {
        state.selectedMainCreatorIDs.delete(row.mainID);
      }
      state.active = state.selectedMainCreatorIDs.size > 0;
      await applyAuthorFilter(state);
      renderAuthorOptionList(state);
    });
    line.appendChild(checkbox);

    const nameNode = container.ownerDocument.createElement("span");
    nameNode.textContent = row.displayName;
    line.appendChild(nameNode);

    const countNode = container.ownerDocument.createElement("span");
    countNode.textContent = String(row.itemCount);
    countNode.style.color = "var(--color-text-secondary)";
    line.appendChild(countNode);

    container.appendChild(line);
  }
  updateStatus(state);
}

function updateStatus(state: AuthorFilterState, resultCount?: number) {
  if (!state.statusNode) {
    return;
  }
  const total = state.options.length;
  const selected = state.selectedMainCreatorIDs.size;
  if (selected > 0 && typeof resultCount === "number") {
    state.statusNode.textContent = getString("author-filter-status-active", {
      args: {
        selected,
        total,
        resultCount,
      },
    });
    return;
  }
  state.statusNode.textContent = getString("author-filter-status-idle", {
    args: {
      selected,
      total,
    },
  });
}

function startSyncTimer(state: AuthorFilterState) {
  if (state.syncTimer) {
    state.win.clearInterval(state.syncTimer);
    state.syncTimer = undefined;
  }
  state.syncTimer = state.win.setInterval(async () => {
    if (state.destroyed) {
      return;
    }
    const currentID = getCurrentCollectionTreeRowID();
    if (!currentID || currentID === state.lastCollectionTreeRowID) {
      return;
    }
    state.lastCollectionTreeRowID = currentID;
    if (state.selectedMainCreatorIDs.size > 0) {
      state.selectedMainCreatorIDs.clear();
      state.active = false;
      renderAuthorOptionList(state);
    }
    await refreshAuthorFilterOptions(state, {
      applyFilter: false,
    });
  }, 1200);
}

function getCurrentCollectionTreeRow() {
  return ZoteroPane?.getCollectionTreeRow?.();
}

function getCurrentCollectionTreeRowID() {
  const row = getCurrentCollectionTreeRow();
  return String(row?.id || "");
}

function getCurrentLibraryID(collectionTreeRow: any) {
  const fromRow = Number(collectionTreeRow?.ref?.libraryID);
  if (fromRow > 0) {
    return fromRow;
  }
  const paneLibraryID = Number(ZoteroPane?.getSelectedLibraryID?.());
  if (paneLibraryID > 0) {
    return paneLibraryID;
  }
  return Number(Zotero.Libraries.userLibraryID) || -1;
}

async function getSearchObjectFromRow(collectionTreeRow: any) {
  if (!collectionTreeRow || typeof collectionTreeRow.getSearchObject !== "function") {
    return undefined;
  }
  try {
    return await collectionTreeRow.getSearchObject();
  } catch (e) {
    return undefined;
  }
}

function cloneSearchWithoutInteractiveFilters(
  sourceSearch: Zotero.Search,
  libraryID: number,
) {
  const cloned = new Zotero.Search({
    libraryID,
  });
  const conditions = Object.values(sourceSearch.getConditions?.() || {});
  for (const rawCondition of conditions) {
    const condition = rawCondition as any;
    if (!condition || !condition.condition) {
      continue;
    }
    if (isInteractiveFilterCondition(condition.condition)) {
      continue;
    }
    addSearchCondition(cloned, condition);
  }
  return cloned;
}

function addInteractiveFilterConditions(
  targetSearch: Zotero.Search,
  sourceSearch?: Zotero.Search,
) {
  if (!sourceSearch) {
    return;
  }
  const conditions = Object.values(sourceSearch.getConditions?.() || {});
  for (const rawCondition of conditions) {
    const condition = rawCondition as any;
    if (!condition || !condition.condition) {
      continue;
    }
    if (!isInteractiveFilterCondition(condition.condition)) {
      continue;
    }
    addSearchCondition(targetSearch, condition);
  }
}

function addSearchCondition(targetSearch: Zotero.Search, condition: any) {
  const conditionName = String(condition.condition || "");
  if (!conditionName) {
    return;
  }
  if (conditionName === "blockStart" || conditionName === "blockEnd") {
    targetSearch.addCondition(conditionName as "blockStart" | "blockEnd");
    return;
  }

  const operator = String(condition.operator || "is");
  const value = condition.value;
  const hasValue = value !== undefined && value !== null && value !== "";
  const required = !!condition.required;
  if (hasValue) {
    targetSearch.addCondition(conditionName, operator, value, required);
  } else {
    targetSearch.addCondition(conditionName, operator);
  }
}

function isInteractiveFilterCondition(conditionName: string) {
  const normalized = String(conditionName || "");
  if (normalized === "tag" || normalized === "tagID") {
    return true;
  }
  return normalized.startsWith("quicksearch");
}

function formatFullName(firstName: string, lastName: string) {
  const cleanFirstName = (firstName || "").trim();
  const cleanLastName = (lastName || "").trim();
  return `${cleanFirstName} ${cleanLastName}`.trim();
}
