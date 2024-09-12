/// @ts-nocheck
import { getString, initLocale } from "../utils/locale";
import { onDialog } from "./authorBrowserDialog";
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

export async function readCreatorAlias() {
  addon.data.authorAliases = JSON.parse(
    getPref("author-alias-db") as string,
  ) as AuthorAliases;
  removeInvalidAuthorAliases();
}

export async function saveCreatorAlias() {
  removeInvalidAuthorAliases();
  setPref("author-alias-db", JSON.stringify(addon.data.authorAliases));
}

export function makeAuthorAlias(mainID: number, aliasID: number) {
  if (addon.data.authorAliases.aliasedCreatorIDs.includes(aliasID)) {
    return 1;
  }
  if (addon.data.authorAliases.aliasedCreatorIDs.includes(mainID)) {
    return 2;
  }
  addon.data.authorAliases.aliasedCreatorIDs.push(aliasID);
  const alias = addon.data.authorAliases.aliases.filter(
    (v, i, a) => v.mainID == mainID,
  );
  if (alias.length == 0)
    addon.data.authorAliases.aliases.push({
      mainID: mainID,
      aliasIDs: [aliasID],
    });
  else alias[0].aliasIDs.push(aliasID);
  return 0;
}

export function removeAuthorAlias(mainID: number, aliasID: number) {
  if (!addon.data.authorAliases.aliasedCreatorIDs.includes(aliasID)) {
    return 1; // aliasID is not an aliased ID.
  }
  const mainIndex = addon.data.authorAliases.aliases.findIndex(
    (v, i, a) => v.mainID == mainID,
  );
  if (mainIndex == -1) {
    return 2; // mainID has no alias
  }
  if (!addon.data.authorAliases.aliases[mainIndex].aliasIDs.includes(aliasID)) {
    return 3; // aliasID is not an alias of mainID
  }
  addon.data.authorAliases.aliasedCreatorIDs =
    addon.data.authorAliases.aliasedCreatorIDs.filter(
      (v, i, n) => v != aliasID,
    );
  addon.data.authorAliases.aliases[mainIndex].aliasIDs =
    addon.data.authorAliases.aliases[mainIndex].aliasIDs.filter(
      (v, i, n) => v != aliasID,
    );
  addon.data.authorAliases.aliases = addon.data.authorAliases.aliases.filter(
    (v, i, n) => v.aliasIDs.length == 0,
  );
  return 0;
}

function removeInvalidAuthorAliases() {
  for (let i = 0; i < addon.data.authorAliases.aliases.length; i++) {
    const alias = addon.data.authorAliases.aliases[i];
    for (let j = 0; j < alias.aliasIDs.length; j++) {
      try {
        Zotero.Creators.get(alias.aliasIDs[j]);
        Zotero.Creators.get(alias.mainID);
      } catch {
        addon.data.authorAliases.aliases.filter((v, index, a) => index != i);
        addon.data.authorAliases.aliasedCreatorIDs.filter(
          (v, index, a) => v != alias.aliasIDs[j],
        );
      }
    }
  }
}

export async function getAllCreators(orderBy: "firstName"|"lastName"|"itemCount"|"creatorID", desc: boolean = false) {
  const doGetAllCreators = Zotero.Promise.coroutine(function* () {
    Zotero.DB.requireTransaction();
    const sql = "SELECT creators.firstName, creators.lastName, creators.creatorID, COUNT(itemCreators.itemID) AS itemCount \
                 FROM creators \
                 JOIN itemCreators ON creators.creatorID = itemCreators.creatorID \
                 WHERE creators.fieldMode = 0\
                 GROUP BY itemCreators.creatorID \
                 ORDER BY " + orderBy + (desc ? " desc" : "");
    const result = yield Zotero.DB.queryAsync(sql);

    return result;
  });

  const creators: CreatorDataRow[] = [];
  let rows;
  await Zotero.DB.executeTransaction(async function () {
    rows = await doGetAllCreators();
    for (let i = 0; i < rows.length; i++) {
      if (
        !addon.data.authorAliases.aliasedCreatorIDs.includes(rows[i].creatorID)
      ) {
        creators.push({
          firstName: rows[i].firstName,
          lastName: rows[i].lastName,
          creatorID: rows[i].creatorID,
          itemCount: rows[i].itemCount,
          aliasIDs: getAllAliasByMainID(rows[i].creatorID),
          aliasFullNames: [],
          aliasFullNamesString: "",
        });
      }
    }
  });
  removeInvalidAuthorAliases();
  for (let i = 0; i < addon.data.authorAliases.aliases.length; i++) {
    const alias = addon.data.authorAliases.aliases[i];
    const mainIndex = creators.findIndex(
      (v2, i2, a2) => v2.creatorID == alias.mainID,
    );
    for (let j = 0; j < alias.aliasIDs.length; j++) {
      const aliasCreator = Zotero.Creators.get(alias.aliasIDs[j]);
      creators[mainIndex].aliasFullNames.push(
        aliasCreator.firstName + " " + aliasCreator.lastName,
      );
      creators[mainIndex].aliasFullNamesString +=
        aliasCreator.firstName + " " + aliasCreator.lastName;
      if (i < addon.data.authorAliases.aliases.length - 1)
        creators[mainIndex].aliasFullNamesString += ", ";
      creators[mainIndex].itemCount +=
        await Zotero.Creators.countItemAssociations(alias.aliasIDs[j]);
    }
  }

  return creators;
}

export function getCreatorMainID(id: number) {
  if (!addon.data.authorAliases.aliasedCreatorIDs.includes(id)) return id;
  const aliases = addon.data.authorAliases.aliases.filter((v, i, a) =>
    v.aliasIDs.includes(id),
  );
  return aliases[0].mainID;
}

export function getAllAliasByMainID(mainID: number) {
  const alias = addon.data.authorAliases.aliases.filter(
    (v, i, a) => v.mainID == mainID,
  );
  if (alias.length) return alias[0].aliasIDs;
  else return [];
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
  const alias = addon.data.authorAliases.aliases.filter(
    (v, i, a) => v.mainID == id,
  );
  if (alias.length != 0)
    alias[0].aliasIDs.forEach((v, i, a) => {
      const aliasCreator = Zotero.Creators.get(v);
      s.addCondition(
        "creator",
        "is",
        aliasCreator.firstName + " " + aliasCreator.lastName,
      );
    });
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
  id = getCreatorMainID(id);
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
