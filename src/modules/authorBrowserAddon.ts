// @ts-nocheck
import { getString, initLocale } from "../utils/locale";
import { onDialog } from "./authorBrowserDialog";

export interface CreatorDataRow {
  firstName: string;
  lastName: string;
  creatorID: number;
  itemCount: number;
}
export interface CreatorQueryDataRow {
  firstName: string;
  lastName: string;
  creatorID: number;
}

export function registerToolsMenuItem() {
  ztoolkit.Menu.register("menuTools", {
    tag: "menuseparator",
  });
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "author-browser-tool-menu-item",
    label: getString("author-browser-tool-menu-item-label"),
    commandListener: (ev) => onDialog(),
  });
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "author-browser-tool-menu-item",
    label: "清空搜索",
    commandListener: (ev) => deleteABSavedSearches(),
  });
}

export function registerCreatorTransformMenuItem() {
  // const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
  // item menuitem with icon
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
      // icon: menuIcon,
    });
  }
}

export async function initAuthorDatabase() {}

export async function readCreatorAlias() {}

export async function getAllCreators() {
  const doGetAllCreators = Zotero.Promise.coroutine(function* () {
    Zotero.DB.requireTransaction();
    const sql = "SELECT * FROM creators ORDER BY firstName";
    const result = yield Zotero.DB.queryAsync(sql);

    return result;
  });

  const creators: CreatorDataRow[] = [];
  await Zotero.DB.executeTransaction(async function () {
    const rows = await doGetAllCreators();
    for (let i = 0; i < rows.length; i++) {
      creators.push({
        firstName: rows[i].firstName,
        lastName: rows[i].lastName,
        creatorID: rows[i].creatorID,
        itemCount: await Zotero.Creators.countItemAssociations(
          rows[i].creatorID,
        ),
      });
    }
  });

  return creators;
}

export async function getCreatorMainID(id: number) {
  const doGetCreatorMainID = Zotero.Promise.coroutine(function* (
    creatorID: number,
  ) {
    addon.data.db.requireTransaction();
    const sql = "SELECT mainID FROM creatorAlias WHERE aliasID = " + creatorID;
    const result: Promise<CreatorQueryDataRow>[] =
      yield addon.data.db.valueQueryAsync(sql);
    return result;
  });
  let creatorMainID: number;
  await addon.data.db.executeTransaction(async function () {
    creatorMainID = await doGetCreatorMainID(id);
  });
  if (creatorMainID) {
    creatorMainID = id;
  }
  return creatorMainID;
}

export async function getAllAliasByMainID(mainId: number) {
  const doGetAllAliasByMainID = Zotero.Promise.coroutine(function* (creatorID) {
    addon.data.db.requireTransaction();
    const sql = "SELECT aliasID FROM creatorAlias WHERE mainID = " + creatorID;
    const result = yield Zotero.DB.queryAsync(sql);
    return result;
  });
  let creatorAliases;
  await addon.data.db.executeTransaction(async function () {
    creatorAliases = await doGetAllAliasByMainID(mainId);
  });
  if (!creatorAliases) {
    creatorAliases = [mainId];
  }
  return creatorAliases;
}

export async function showAuthorByID(id: number) {
  const creator = Zotero.Creators.get(id);
  const fullName = creator.firstName + " " + creator.lastName;
  const s = new Zotero.Search({
    name: fullName,
    libraryID: Zotero.Libraries.userLibraryID,
  });
  s.addCondition("joinMode", "any");
  s.addCondition("creator", "is", creator.firstName + " " + creator.lastName);

  //addAuthorSearchAndSelect(s);
  //showSearchToItemsView(s);
  saveSearchAndSelect(s);
}

export async function showAuthorFromPopupMenu(ev: Event) {
  let row;
  let fields;
  if (ev.target) {
    row = (ev.target as XULPopupElement).ownerDocument.popupNode.closest(
      ".meta-row",
    );
  } else {
    return;
  }
  if (ZoteroPane.itemPane) {
    fields = ZoteroPane.itemPane
      .querySelector("item-box")
      .getCreatorFields(row);
  }
  let id: number;
  await Zotero.DB.executeTransaction(async function () {
    id = await Zotero.Creators.getIDFromData({
      creatorType: Zotero.CreatorTypes.getName(fields.creatorTypeID),
      firstName: fields.firstName,
      lastName: fields.lastName,
    });
  });
  showAuthorByID(id);
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
  ).filter((s) => !s.deleted);
  for (let i = 0; i < savedSearches.length; i++) {
    if (savedSearches[i].name == s.name) {
      ZoteroPane.collectionsView.selectItem(savedSearches[i].id);
    }
  }
}
