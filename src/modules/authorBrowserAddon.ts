/// @ts-nocheck
import { getString } from "../utils/locale";
import { onDialog, runBatchMergeFromToolMenu } from "./authorBrowserDialog";
import { getPref, setPref } from "../utils/prefs";

export interface CreatorDataRow {
  firstName: string;
  lastName: string;
  creatorID: number;
  aliasIDs: Array<number>;
  aliasFullNames: Array<string>;
  aliasFullNamesString: string;
  itemCount: number;
}

export interface CreatorQueryDataRow {
  firstName: string;
  lastName: string;
  creatorID: number;
}

export interface CreatorStatDataRow extends CreatorQueryDataRow {
  itemCount: number;
}

interface AuthorAliasGroup {
  mainID: number;
  aliasIDs: number[];
}

interface AuthorAliasState {
  aliasedCreatorIDs: number[];
  aliases: AuthorAliasGroup[];
}

type CreatorSortKey = "firstName" | "lastName" | "itemCount" | "creatorID";

export type AliasMutation =
  | {
      type: "add";
      mainID: number;
      creatorIDs: number[];
      mergeGroups?: boolean;
      dryRun?: boolean;
    }
  | {
      type: "remove";
      mainID: number;
      creatorIDs: number[];
    }
  | {
      type: "replace";
      aliases: AuthorAliasState;
    };

export interface AliasMutationResult {
  mainID: number;
  addedAliasIDs: number[];
  removedAliasIDs: number[];
  conflictAliasIDs: number[];
  skippedAliasIDs: number[];
  mergedGroupMainIDs: number[];
  mergedCreatorIDs: number[];
}

const AUTHOR_STAT_CREATOR_TYPE_IDS = [8, 24, 15];
const AUTHOR_STAT_CREATOR_TYPE_IDS_SQL = AUTHOR_STAT_CREATOR_TYPE_IDS.join(", ");
const AUTHOR_ALIAS_PREF_KEY = "author-alias-db";
const GOOGLE_SCHOLAR_SEARCH_URL = "https://scholar.google.com/scholar";
const CNKI_SEARCH_URL = "https://kns.cnki.net/kns8s/defaultresult/index";
const EMPTY_ALIAS_STATE: AuthorAliasState = {
  aliasedCreatorIDs: [],
  aliases: [],
};
const VALID_SORT_KEYS: CreatorSortKey[] = [
  "firstName",
  "lastName",
  "itemCount",
  "creatorID",
];

let authorAliasesLoaded = false;

export function registerToolsMenuItem() {
  ztoolkit.Menu.register("menuTools", {
    tag: "menuseparator",
  });
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "author-browser-tool-menu-open",
    label: getString("tool-menu-item-label"),
    commandListener: () => onDialog(),
  });
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "author-browser-tool-menu-clear-search",
    label: getString("tool-menu-clear-search"),
    commandListener: async () => {
      const module = await import("./authorFilterPanel");
      const cleared = await module.clearAuthorFilter();
      if (!cleared) {
        await deleteABSavedSearches();
      }
    },
  });
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "author-browser-tool-menu-auto-merge",
    label: getString("tool-menu-auto-merge"),
    commandListener: () => runBatchMergeFromToolMenu(),
  });
}

export function registerCreatorTransformMenuItem() {
  const menu = ztoolkit.Menu.getGlobal("document").querySelector(
    "#zotero-creator-transform-menu",
  ) as XUL.MenuPopup;
  if (menu) {
    ztoolkit.Menu.register(menu, {
      tag: "menuseparator",
    });
    ztoolkit.Menu.register(menu, {
      tag: "menuitem",
      id: "zotero-show-author",
      label: getString("show-author"),
      commandListener: async (ev) => showAuthorFromPopupMenu(ev),
    });
    ztoolkit.Menu.register(menu, {
      tag: "menuitem",
      id: "zotero-search-author-google-scholar",
      label: getString("search-author-google-scholar"),
      commandListener: async (ev) => searchAuthorInGoogleScholarFromPopupMenu(ev),
    });
    ztoolkit.Menu.register(menu, {
      tag: "menuitem",
      id: "zotero-search-author-cnki",
      label: getString("search-author-cnki"),
      commandListener: async (ev) => searchAuthorInCNKIFromPopupMenu(ev),
    });
  }
}

export function cloneAuthorAliases(source?: AuthorAliasState) {
  const raw = source || addon.data.authorAliases || createEmptyAliasState();
  return normalizeAuthorAliases(raw);
}

export function isCreatorAliased(creatorID: number) {
  ensureAuthorAliasesLoaded();
  return addon.data.authorAliases.aliasedCreatorIDs.includes(creatorID);
}

export function hasAliasGroup(mainID: number) {
  ensureAuthorAliasesLoaded();
  const resolvedMainID = resolveMainID(mainID);
  return getAliasGroupByMainID(resolvedMainID)?.aliasIDs.length > 0;
}

export function expandGroupForMerge(mainID: number) {
  ensureAuthorAliasesLoaded();
  const resolvedMainID = resolveMainID(mainID);
  if (!isValidCreatorID(resolvedMainID) || !creatorExists(resolvedMainID)) {
    return [];
  }
  const group = getAliasGroupByMainID(resolvedMainID);
  if (!group) {
    return [resolvedMainID];
  }
  return [resolvedMainID, ...group.aliasIDs];
}

export async function readCreatorAlias(forceReload = false) {
  ensureAuthorAliasesLoaded(forceReload);
  return cloneAuthorAliases();
}

export async function saveCreatorAlias() {
  ensureAuthorAliasesLoaded();
  addon.data.authorAliases = normalizeAuthorAliases(addon.data.authorAliases);
  persistAuthorAliases();
  notifyAuthorFilterAliasChanged();
}

export function resolveMainID(id: number) {
  ensureAuthorAliasesLoaded();
  if (!isValidCreatorID(id)) {
    return -1;
  }
  if (!addon.data.authorAliases.aliasedCreatorIDs.includes(id)) {
    return id;
  }
  const alias = addon.data.authorAliases.aliases.find((group) =>
    group.aliasIDs.includes(id),
  );
  return alias ? alias.mainID : id;
}

export function makeAuthorAlias(mainID: number, aliasID: number) {
  ensureAuthorAliasesLoaded();
  if (!isValidCreatorID(mainID) || !isValidCreatorID(aliasID)) {
    return 5;
  }
  const resolvedMainID = resolveMainID(mainID);
  const resolvedAliasID = resolveMainID(aliasID);
  if (resolvedMainID <= 0 || resolvedAliasID <= 0) {
    return 5;
  }
  if (resolvedMainID === resolvedAliasID) {
    return 4;
  }
  if (resolvedAliasID !== aliasID) {
    return 1;
  }
  if (hasAliasGroup(aliasID)) {
    return 3;
  }
  if (addon.data.authorAliases.aliasedCreatorIDs.includes(aliasID)) {
    return 1;
  }
  const group = getOrCreateAliasGroup(resolvedMainID);
  if (!group.aliasIDs.includes(aliasID)) {
    group.aliasIDs.push(aliasID);
  }
  if (!addon.data.authorAliases.aliasedCreatorIDs.includes(aliasID)) {
    addon.data.authorAliases.aliasedCreatorIDs.push(aliasID);
  }
  addon.data.authorAliases = normalizeAuthorAliases(addon.data.authorAliases);
  persistAuthorAliases();
  notifyAuthorFilterAliasChanged();
  return 0;
}

export function removeAuthorAlias(mainID: number, aliasID: number) {
  ensureAuthorAliasesLoaded();
  if (!isValidCreatorID(mainID) || !isValidCreatorID(aliasID)) {
    return 4;
  }
  const resolvedMainID = resolveMainID(mainID);
  const group = getAliasGroupByMainID(resolvedMainID);
  if (!group) {
    return 2;
  }
  if (!addon.data.authorAliases.aliasedCreatorIDs.includes(aliasID)) {
    return 1;
  }
  if (!group.aliasIDs.includes(aliasID)) {
    return 3;
  }
  group.aliasIDs = group.aliasIDs.filter((id) => id !== aliasID);
  addon.data.authorAliases.aliasedCreatorIDs =
    addon.data.authorAliases.aliasedCreatorIDs.filter((id) => id !== aliasID);
  addon.data.authorAliases.aliases = addon.data.authorAliases.aliases.filter(
    (currentGroup) =>
      currentGroup.mainID !== resolvedMainID || currentGroup.aliasIDs.length > 0,
  );
  addon.data.authorAliases = normalizeAuthorAliases(addon.data.authorAliases);
  persistAuthorAliases();
  notifyAuthorFilterAliasChanged();
  return 0;
}

export async function applyAliasMutation(
  mutation: AliasMutation,
): Promise<AliasMutationResult> {
  ensureAuthorAliasesLoaded();
  const result: AliasMutationResult = {
    mainID: -1,
    addedAliasIDs: [],
    removedAliasIDs: [],
    conflictAliasIDs: [],
    skippedAliasIDs: [],
    mergedGroupMainIDs: [],
    mergedCreatorIDs: [],
  };
  if (!mutation) {
    return result;
  }

  if (mutation.type === "replace") {
    addon.data.authorAliases = normalizeAuthorAliases(mutation.aliases);
    persistAuthorAliases();
    notifyAuthorFilterAliasChanged();
    return result;
  }

  const rawMainID = Number(mutation.mainID);
  const resolvedMainID = resolveMainID(rawMainID);
  result.mainID = resolvedMainID;
  if (!isValidCreatorID(resolvedMainID) || !creatorExists(resolvedMainID)) {
    return result;
  }

  const mergeGroups = mutation.type === "add" && !!mutation.mergeGroups;
  const dryRun = mutation.type === "add" && !!mutation.dryRun;

  const creatorIDs = Array.from(
    new Set((mutation.creatorIDs || []).map((id) => Number(id))),
  ).filter((id) => isValidCreatorID(id) && creatorExists(id));
  const conflictSet = new Set<number>();
  const skippedSet = new Set<number>();
  const addedSet = new Set<number>();
  const removedSet = new Set<number>();
  const mergedGroupSet = new Set<number>();
  const mergedCreatorSet = new Set<number>();
  let targetGroup: AuthorAliasGroup | undefined = undefined;

  const maybeAddAliasToTarget = (aliasID: number) => {
    if (!targetGroup) {
      targetGroup = getOrCreateAliasGroup(resolvedMainID);
    }
    if (aliasID === resolvedMainID) {
      skippedSet.add(aliasID);
      return;
    }
    if (targetGroup.aliasIDs.includes(aliasID)) {
      skippedSet.add(aliasID);
      return;
    }
    addedSet.add(aliasID);
    if (!dryRun) {
      targetGroup.aliasIDs.push(aliasID);
      if (!addon.data.authorAliases.aliasedCreatorIDs.includes(aliasID)) {
        addon.data.authorAliases.aliasedCreatorIDs.push(aliasID);
      }
    }
  };

  const mergeSourceGroup = (sourceMainID: number, markerID: number) => {
    if (!isValidCreatorID(sourceMainID) || sourceMainID === resolvedMainID) {
      skippedSet.add(markerID);
      return;
    }
    const sourceMembers = expandGroupForMerge(sourceMainID);
    if (sourceMembers.length === 0) {
      skippedSet.add(markerID);
      return;
    }
    mergedGroupSet.add(sourceMainID);
    for (const memberID of sourceMembers) {
      if (memberID === resolvedMainID) {
        continue;
      }
      mergedCreatorSet.add(memberID);
      maybeAddAliasToTarget(memberID);
    }
    if (!dryRun) {
      addon.data.authorAliases.aliases = addon.data.authorAliases.aliases.filter(
        (group) => group.mainID !== sourceMainID,
      );
    }
  };

  if (mutation.type === "add") {
    for (const candidateID of creatorIDs) {
      const candidateMainID = resolveMainID(candidateID);
      if (candidateMainID === resolvedMainID) {
        skippedSet.add(candidateID);
        continue;
      }
      if (candidateMainID !== candidateID || hasAliasGroup(candidateID)) {
        if (!mergeGroups) {
          conflictSet.add(candidateID);
          continue;
        }
        const sourceMainID =
          candidateMainID !== candidateID ? candidateMainID : candidateID;
        mergeSourceGroup(sourceMainID, candidateID);
        continue;
      }
      maybeAddAliasToTarget(candidateID);
    }
  } else if (mutation.type === "remove") {
    const group = getAliasGroupByMainID(resolvedMainID);
    if (!group) {
      result.skippedAliasIDs = creatorIDs;
      return result;
    }
    for (const candidateID of creatorIDs) {
      const existingIndex = group.aliasIDs.indexOf(candidateID);
      if (existingIndex < 0) {
        skippedSet.add(candidateID);
        continue;
      }
      removedSet.add(candidateID);
      if (!dryRun) {
        group.aliasIDs.splice(existingIndex, 1);
        addon.data.authorAliases.aliasedCreatorIDs =
          addon.data.authorAliases.aliasedCreatorIDs.filter(
            (id) => id !== candidateID,
          );
      }
    }
  }

  result.addedAliasIDs = Array.from(addedSet);
  result.removedAliasIDs = Array.from(removedSet);
  result.mergedGroupMainIDs = Array.from(mergedGroupSet);
  result.mergedCreatorIDs = Array.from(mergedCreatorSet);
  result.conflictAliasIDs = Array.from(conflictSet);
  result.skippedAliasIDs = Array.from(skippedSet);

  if (!dryRun) {
    addon.data.authorAliases.aliases = addon.data.authorAliases.aliases.filter(
      (currentGroup) =>
        currentGroup.mainID !== resolvedMainID || currentGroup.aliasIDs.length > 0,
    );
    addon.data.authorAliases = normalizeAuthorAliases(addon.data.authorAliases);
    persistAuthorAliases();
    notifyAuthorFilterAliasChanged();
  }

  result.conflictAliasIDs = Array.from(conflictSet);
  return result;
}

export async function getAllCreatorStats(
  orderBy: CreatorSortKey = "itemCount",
  desc = true,
) {
  ensureAuthorAliasesLoaded();
  return queryCreatorStats(orderBy, desc);
}

export async function getAllCreators(
  orderBy: CreatorSortKey,
  desc = false,
): Promise<CreatorDataRow[]> {
  ensureAuthorAliasesLoaded();
  const rows = await queryCreatorStats(orderBy, desc);
  const countMap = new Map<number, number>();
  const nameMap = new Map<number, { firstName: string; lastName: string }>();
  for (const row of rows) {
    countMap.set(row.creatorID, row.itemCount);
    nameMap.set(row.creatorID, {
      firstName: row.firstName,
      lastName: row.lastName,
    });
  }

  const creators: CreatorDataRow[] = [];
  for (const row of rows) {
    if (row.itemCount <= 0) {
      continue;
    }
    if (addon.data.authorAliases.aliasedCreatorIDs.includes(row.creatorID)) {
      continue;
    }
    creators.push({
      firstName: row.firstName,
      lastName: row.lastName,
      creatorID: row.creatorID,
      itemCount: row.itemCount,
      aliasIDs: getAllAliasByMainID(row.creatorID),
      aliasFullNames: [],
      aliasFullNamesString: "",
    });
  }

  for (const creator of creators) {
    const aliases = getAllAliasByMainID(creator.creatorID);
    for (const aliasID of aliases) {
      const aliasName = nameMap.get(aliasID) || readCreatorName(aliasID);
      if (!aliasName) {
        continue;
      }
      const fullName = formatFullName(aliasName.firstName, aliasName.lastName);
      if (fullName) {
        creator.aliasFullNames.push(fullName);
      }
      if (countMap.has(aliasID)) {
        creator.itemCount += countMap.get(aliasID) || 0;
      } else {
        creator.itemCount += await countCreatorItemsForAuthorStats(aliasID);
      }
    }
    creator.aliasFullNamesString = creator.aliasFullNames.join(", ");
  }

  return creators;
}

async function countCreatorItemsForAuthorStats(creatorID: number) {
  const sql =
    "SELECT COUNT(DISTINCT itemCreators.itemID) AS itemCount \
               FROM itemCreators \
               JOIN creators ON creators.creatorID = itemCreators.creatorID \
               WHERE creators.fieldMode = 0 \
                 AND itemCreators.creatorID = ? \
                 AND itemCreators.creatorTypeID IN (" +
    AUTHOR_STAT_CREATOR_TYPE_IDS_SQL +
    ")";
  const rows = await Zotero.DB.queryAsync(sql, [creatorID]);
  if (!rows || rows.length === 0) {
    return 0;
  }
  return Number(rows[0].itemCount) || 0;
}

export function getCreatorMainID(id: number) {
  ensureAuthorAliasesLoaded();
  return resolveMainID(id);
}

export function getAllAliasByMainID(mainID: number) {
  ensureAuthorAliasesLoaded();
  const resolvedMainID = resolveMainID(mainID);
  const alias = addon.data.authorAliases.aliases.find(
    (group) => group.mainID === resolvedMainID,
  );
  if (!alias) {
    return [];
  }
  return [...alias.aliasIDs];
}

export async function showAuthorByID(id: number) {
  ensureAuthorAliasesLoaded();
  const panelModule = await import("./authorFilterPanel");
  const usedPanel = await panelModule.activateAuthorFilterByCreatorID(id);
  if (usedPanel) {
    return;
  }
  const mainID = resolveMainID(id);
  const creator = Zotero.Creators.get(mainID);
  if (!creator) {
    return;
  }
  const fullName = formatFullName(creator.firstName, creator.lastName);
  const selectedLibraryID = Number(ZoteroPane?.getSelectedLibraryID?.());
  const fallbackLibraryID =
    selectedLibraryID > 0 ? selectedLibraryID : Zotero.Libraries.userLibraryID;
  const s = new Zotero.Search({
    name: fullName,
    libraryID: fallbackLibraryID,
  });
  s.addCondition("joinMode", "any");
  s.addCondition("creator", "is", fullName);
  const aliases = getAllAliasByMainID(mainID);
  for (const aliasID of aliases) {
    const aliasCreator = Zotero.Creators.get(aliasID);
    if (!aliasCreator) {
      continue;
    }
    const aliasFullName = formatFullName(
      aliasCreator.firstName,
      aliasCreator.lastName,
    );
    s.addCondition("creator", "is", aliasFullName);
  }
  saveSearchAndSelect(s);
}

export async function showAuthorFromPopupMenu(ev: Event) {
  const id = await resolveCreatorIDFromPopupMenuEvent(ev);
  if (id <= 0) {
    return;
  }
  await showAuthorByID(id);
}

export async function searchAuthorInGoogleScholarByID(id: number) {
  ensureAuthorAliasesLoaded();
  const mainID = resolveMainID(id);
  const creator = Zotero.Creators.get(mainID);
  if (!creator) {
    return;
  }
  const fullName = formatScholarAuthorName(creator.firstName, creator.lastName);
  if (!fullName) {
    return;
  }
  const query = `author:"${fullName}"`;
  const url = `${GOOGLE_SCHOLAR_SEARCH_URL}?q=${encodeURIComponent(query)}`;
  Zotero.launchURL(url);
}

export async function searchAuthorInGoogleScholarFromPopupMenu(ev: Event) {
  const id = await resolveCreatorIDFromPopupMenuEvent(ev);
  if (id <= 0) {
    return;
  }
  searchAuthorInGoogleScholarByID(id);
}

export async function searchAuthorInCNKIByID(id: number) {
  ensureAuthorAliasesLoaded();
  const mainID = resolveMainID(id);
  const creator = Zotero.Creators.get(mainID);
  if (!creator) {
    return;
  }
  const fullName = formatScholarAuthorName(creator.firstName, creator.lastName);
  if (!fullName) {
    return;
  }
  const url = `${CNKI_SEARCH_URL}?korder=AU&kw=${encodeURIComponent(fullName)}`;
  Zotero.launchURL(url);
}

export async function searchAuthorInCNKIFromPopupMenu(ev: Event) {
  const id = await resolveCreatorIDFromPopupMenuEvent(ev);
  if (id <= 0) {
    return;
  }
  searchAuthorInCNKIByID(id);
}

async function resolveCreatorIDFromPopupMenuEvent(ev: Event) {
  const contextNodes = collectCreatorContextNodes(ev);
  const itemBox = findItemBoxForCreatorFields(contextNodes);
  if (!itemBox) {
    Zotero.debug?.("[AuthorBrowser] Could not find itemBox with getCreatorFields");
    return -1;
  }

  let fields: any = null;
  for (const node of contextNodes) {
    fields = tryReadCreatorFieldsFromPopupNode(itemBox, node);
    if (fields) {
      break;
    }
  }
  if (!fields) {
    Zotero.debug?.("[AuthorBrowser] Could not resolve creator fields from context nodes");
    return -1;
  }

  const firstName = String(fields.firstName || "").trim();
  const lastName = String(fields.lastName || "").trim();
  if (!firstName && !lastName) {
    return -1;
  }

  const creatorType =
    typeof fields.creatorType === "string" && fields.creatorType
      ? fields.creatorType
      : typeof fields.creatorTypeID === "number"
        ? Zotero.CreatorTypes.getName(fields.creatorTypeID)
        : "author";
  const isSingleFieldName =
    Number(fields.fieldMode) === 1 || (!firstName && !!lastName);

  let id: number;
  await Zotero.DB.executeTransaction(async function () {
    const creatorData = isSingleFieldName
      ? {
          creatorType,
          name: lastName,
        }
      : {
          creatorType,
          firstName,
          lastName,
        };
    id = await Zotero.Creators.getIDFromData(creatorData as any);
  });
  if (typeof id !== "number") {
    return -1;
  }
  return resolveMainID(id);
}

function collectCreatorContextNodes(ev: Event) {
  const target = ev.target as Element | null;
  const currentTarget = ev.currentTarget as Element | null;
  const popup = target?.closest?.("menupopup") as XULPopupElement | null;
  const targetDoc = target?.ownerDocument || currentTarget?.ownerDocument || null;
  const mainDoc = Zotero.getMainWindow()?.document || null;
  const globalDoc = ztoolkit?.Menu?.getGlobal?.("document") as Document | null;
  return dedupeElements([
    (popup as any)?.triggerNode as Element | null,
    (target as any)?.triggerNode as Element | null,
    (currentTarget as any)?.triggerNode as Element | null,
    (targetDoc as any)?.popupNode as Element | null,
    (mainDoc as any)?.popupNode as Element | null,
    (globalDoc as any)?.popupNode as Element | null,
    targetDoc?.activeElement as Element | null,
    mainDoc?.activeElement as Element | null,
    globalDoc?.activeElement as Element | null,
  ]);
}

function dedupeElements(nodes: Array<Element | null | undefined>) {
  const deduped: Element[] = [];
  for (const node of nodes) {
    if (!isDomElementNode(node)) {
      continue;
    }
    if (!deduped.includes(node)) {
      deduped.push(node);
    }
  }
  return deduped;
}

function isDomElementNode(node: any): node is Element {
  return (
    !!node &&
    typeof node === "object" &&
    node.nodeType === 1 &&
    typeof node.closest === "function"
  );
}

function findItemBoxForCreatorFields(contextNodes: Element[]) {
  const candidates: any[] = [];

  const collectFromDoc = (doc: Document | null | undefined) => {
    if (!doc) {
      return;
    }
    candidates.push(doc.querySelector("item-box"));
    candidates.push(doc.querySelector("info-box"));
    candidates.push(doc.getElementById("zotero-editpane-item-box"));
  };

  for (const node of contextNodes) {
    candidates.push(node.closest?.("item-box"));
    candidates.push(node.closest?.("info-box"));
    collectFromDoc(node.ownerDocument);
  }

  const pane = ZoteroPane?.itemPane as any;
  if (pane) {
    candidates.push(pane.itemBox);
    candidates.push(pane._itemBox);
    candidates.push(pane.querySelector?.("item-box"));
    candidates.push(pane.querySelector?.("info-box"));
    candidates.push(pane.getCurrentPane?.("info"));
    const currentPane = pane.getCurrentPane?.();
    candidates.push(currentPane?.querySelector?.("item-box"));
    candidates.push(currentPane?.querySelector?.("info-box"));
  }

  const mainDoc = Zotero.getMainWindow()?.document;
  collectFromDoc(mainDoc);

  for (const candidate of candidates) {
    if (candidate && typeof candidate.getCreatorFields === "function") {
      return candidate;
    }
  }
  return null;
}

function tryReadCreatorFieldsFromPopupNode(itemBox: any, popupNode: Element) {
  const candidates: Element[] = [];
  let current: Element | null = popupNode;
  while (current) {
    candidates.push(current);
    current = current.parentElement;
  }
  const extraCandidates = [
    popupNode.closest(".meta-row"),
    popupNode.closest('[data-row-id*="creator"]'),
    popupNode.closest('[data-fieldname="creators"]'),
    popupNode.closest('[data-fieldname="creator"]'),
    popupNode.closest('[fieldname="creator"]'),
  ].filter(Boolean) as Element[];
  for (const candidate of extraCandidates) {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  for (const candidate of candidates) {
    try {
      const fields = itemBox.getCreatorFields(candidate);
      if (
        fields &&
        (typeof fields.firstName === "string" ||
          typeof fields.lastName === "string")
      ) {
        return fields;
      }
    } catch (e) {
      // Keep trying parent/alternative nodes until fields are found.
    }
  }
  return null;
}

export async function deleteABSavedSearches() {
  const savedSearches = await Zotero.Searches.getAll(
    Zotero.Libraries.userLibraryID,
  )
    .filter((s) => !s.deleted)
    .filter((s) => (s.name as string).startsWith("[AB Temp]"));

  for (let i = 0; i < savedSearches.length; i++) {
    savedSearches[i].eraseTx();
  }
}

async function queryCreatorStats(orderBy: CreatorSortKey, desc: boolean) {
  const safeSortKey = VALID_SORT_KEYS.includes(orderBy) ? orderBy : "itemCount";
  const sql =
    "SELECT creators.firstName, creators.lastName, creators.creatorID, COUNT(DISTINCT itemCreators.itemID) AS itemCount \
                 FROM creators \
                 JOIN itemCreators ON creators.creatorID = itemCreators.creatorID \
                 WHERE creators.fieldMode = 0 AND itemCreators.creatorTypeID IN (" +
    AUTHOR_STAT_CREATOR_TYPE_IDS_SQL +
    ") \
                 GROUP BY itemCreators.creatorID \
                 ORDER BY " +
    safeSortKey +
    (desc ? " desc" : "");

  let rows: any[] = [];
  await Zotero.DB.executeTransaction(async function () {
    rows = await Zotero.DB.queryAsync(sql);
  });

  return (rows || []).map((row) => ({
    firstName: row.firstName || "",
    lastName: row.lastName || "",
    creatorID: Number(row.creatorID) || -1,
    itemCount: Number(row.itemCount) || 0,
  })) as CreatorStatDataRow[];
}

function ensureAuthorAliasesLoaded(forceReload = false) {
  if (forceReload) {
    authorAliasesLoaded = false;
  }
  if (authorAliasesLoaded) {
    return;
  }
  const rawValue = getPref(AUTHOR_ALIAS_PREF_KEY);
  let parsedValue: any = undefined;
  if (typeof rawValue === "string" && rawValue.trim()) {
    try {
      parsedValue = JSON.parse(rawValue);
    } catch (e) {
      parsedValue = undefined;
    }
  }
  const normalized = normalizeAuthorAliases(parsedValue);
  addon.data.authorAliases = normalized;
  authorAliasesLoaded = true;
  const normalizedSerialized = JSON.stringify(normalized);
  if (rawValue !== normalizedSerialized) {
    setPref(AUTHOR_ALIAS_PREF_KEY, normalizedSerialized);
  }
}

function persistAuthorAliases() {
  const normalized = normalizeAuthorAliases(addon.data.authorAliases);
  addon.data.authorAliases = normalized;
  setPref(AUTHOR_ALIAS_PREF_KEY, JSON.stringify(normalized));
}

function notifyAuthorFilterAliasChanged() {
  import("./authorFilterPanel")
    .then((module) => module.refreshAuthorFilterIfOpen())
    .catch(() => undefined);
}

function normalizeAuthorAliases(rawValue: any): AuthorAliasState {
  const normalized = createEmptyAliasState();
  if (!rawValue || !Array.isArray(rawValue.aliases)) {
    return normalized;
  }

  const aliasedSet = new Set<number>();
  for (const rawGroup of rawValue.aliases) {
    const mainID = Number(rawGroup?.mainID);
    if (!isValidCreatorID(mainID) || !creatorExists(mainID)) {
      continue;
    }
    if (aliasedSet.has(mainID)) {
      continue;
    }
    const rawAliasIDs = Array.isArray(rawGroup?.aliasIDs)
      ? rawGroup.aliasIDs
      : [];
    const aliasIDs: number[] = [];
    for (const rawAliasID of rawAliasIDs) {
      const aliasID = Number(rawAliasID);
      if (!isValidCreatorID(aliasID) || aliasID === mainID) {
        continue;
      }
      if (!creatorExists(aliasID)) {
        continue;
      }
      if (aliasedSet.has(aliasID)) {
        continue;
      }
      if (aliasIDs.includes(aliasID)) {
        continue;
      }
      aliasIDs.push(aliasID);
      aliasedSet.add(aliasID);
    }
    if (aliasIDs.length > 0) {
      normalized.aliases.push({
        mainID,
        aliasIDs,
      });
    }
  }
  normalized.aliasedCreatorIDs = Array.from(aliasedSet);
  return normalized;
}

function createEmptyAliasState(): AuthorAliasState {
  return {
    aliasedCreatorIDs: [...EMPTY_ALIAS_STATE.aliasedCreatorIDs],
    aliases: [],
  };
}

function getOrCreateAliasGroup(mainID: number) {
  let group = getAliasGroupByMainID(mainID);
  if (!group) {
    group = {
      mainID,
      aliasIDs: [],
    };
    addon.data.authorAliases.aliases.push(group);
  }
  return group;
}

export function getAliasGroupByMainID(mainID: number) {
  return addon.data.authorAliases.aliases.find((group) => group.mainID === mainID);
}

function readCreatorName(creatorID: number) {
  const creator = Zotero.Creators.get(creatorID);
  if (!creator) {
    return undefined;
  }
  return {
    firstName: creator.firstName || "",
    lastName: creator.lastName || "",
  };
}

function creatorExists(creatorID: number) {
  if (!isValidCreatorID(creatorID)) {
    return false;
  }
  try {
    const creator = Zotero.Creators.get(creatorID);
    return !!creator;
  } catch (e) {
    return false;
  }
}

function isValidCreatorID(creatorID: number) {
  return Number.isInteger(creatorID) && creatorID > 0;
}

function formatFullName(firstName: string, lastName: string) {
  const cleanFirstName = (firstName || "").trim();
  const cleanLastName = (lastName || "").trim();
  return `${cleanFirstName} ${cleanLastName}`.trim();
}

function formatScholarAuthorName(firstName: string, lastName: string) {
  const cleanFirstName = (firstName || "").trim();
  const cleanLastName = (lastName || "").trim();
  if (!cleanFirstName && !cleanLastName) {
    return "";
  }
  if (containsCJK(cleanFirstName) || containsCJK(cleanLastName)) {
    return `${cleanLastName}${cleanFirstName}`.trim();
  }
  return formatFullName(cleanFirstName, cleanLastName);
}

function containsCJK(text: string) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/i.test(
    text || "",
  );
}

async function showSearchToItemsView(s: Zotero.Search) {
  const collectionTreeRow = {
    view: {},
    ref: s,
    visibilityGroup: "default",
    isSearchMode: () => true,
    getItems: async function () {
      const lib = Zotero.Libraries.get(Zotero.Libraries.userLibraryID);
      if (lib) await lib.waitForDataLoad("item");
      else return false;
      const ids = await s.search();
      return Zotero.Items.get(ids);
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
  const itemsView = ZoteroPane.itemsView;
  if (itemsView) itemsView.changeCollectionTreeRow(collectionTreeRow);
  else return;
  if (ZoteroPane.collectionsView)
    await ZoteroPane.collectionsView.selection.clearSelection();
  else return;
  (document.getElementById("item-tree-main-default") as XULTreeElement).focus();
  ZoteroPane.collectionsView.runListeners("select");
}

function saveSearchAndSelect(s: Zotero.Search) {
  deleteABSavedSearches();
  s.name = "[AB Temp] " + s.name;
  s.saveTx();
  const savedSearches = Zotero.Searches.getAll(
    Zotero.Libraries.userLibraryID,
  ).filter((item) => !item.deleted);
  for (let i = 0; i < savedSearches.length; i++) {
    if (savedSearches[i].name == s.name) {
      ZoteroPane.collectionsView.selectItem(savedSearches[i].id);
    }
  }
}
