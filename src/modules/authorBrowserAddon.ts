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

class AuthorBrowserAddon {
  static registerToolsMenuItem() {
    ztoolkit.Menu.register("menuTools", {
      tag: "menuseparator",
    });
    ztoolkit.Menu.register("menuTools", {
      tag: "menuitem",
      id: "author-browser-tool-menu-item",
      label: getString("author-browser-tool-menu-item-label"),
      commandListener: (ev) => onDialog(),
    });
  }
  private db;

  static registerCreatorTransformMenuItem() {
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
        commandListener: async (ev) =>
          addon.authorBrowserAddon.showAuthorFromPopupMenu(ev),
        // icon: menuIcon,
      });
    }
  }

  public async initAuthorDatabase() {}

  public async readCreatorAlias() {}

  public async getAllCreators() {
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

  public async getCreatorMainID(id: number) {
    const doGetCreatorMainID = Zotero.Promise.coroutine(function* (
      creatorID: number,
    ) {
      this.db.requireTransaction();
      const sql =
        "SELECT mainID FROM creatorAlias WHERE aliasID = " + creatorID;
      const result: Promise<CreatorQueryDataRow>[] =
        yield this.db.valueQueryAsync(sql);
      return result;
    });
    let creatorMainID: number;
    await this.db.executeTransaction(async function () {
      creatorMainID = await doGetCreatorMainID(id);
    });
    if (creatorMainID) {
      creatorMainID = id;
    }
    return creatorMainID;
  }

  public async getAllAliasByMainID(mainId: number) {
    const doGetAllAliasByMainID = Zotero.Promise.coroutine(
      function* (creatorID) {
        this.db.requireTransaction();
        const sql =
          "SELECT aliasID FROM creatorAlias WHERE mainID = " + creatorID;
        const result = yield Zotero.DB.queryAsync(sql);
        return result;
      },
    );
    let creatorAliases;
    await this.db.executeTransaction(async function () {
      creatorAliases = await doGetAllAliasByMainID(mainId);
    });
    if (!creatorAliases) {
      creatorAliases = [mainId];
    }
    return creatorAliases;
  }

  public async showAuthorByID(id: number) {
    const creator = Zotero.Creators.get(id);
    const fullName = creator.firstName + " " + creator.lastName;
    const s = new Zotero.Search({
      name: fullName,
      libraryID: Zotero.Libraries.userLibraryID,
    });
    s.addCondition("joinMode", "any");
    s.addCondition("creator", "is", creator.firstName + " " + creator.lastName);
    // TODO: Combined creators
    //
    // const mainID = await this.getCreatorMainID(id);
    // const creator = Zotero.Creators.get(mainID);
    // const fullName = creator.firstName + ' '+ creator.lastName;
    // const s = new Zotero.Search({name : "ShowAuthor", libraryID: Zotero.Libraries.userLibraryID});
    // s.name = fullName;
    // s.addCondition('joinMode', 'any');
    // let creatorAliases = await this.getAllAliasByMainID(mainID)
    // for(let i = 0; i < creatorAliases.length; i++){
    //   const creatorAlias = Zotero.Creators.get(creatorAliases[i]);
    //   s.addCondition('creator', 'is', creatorAlias.firstName + ' '+ creatorAlias.lastName)
    // }
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
    (
      document.getElementById("item-tree-main-default") as XULTreeElement
    ).focus();
    ZoteroPane.collectionsView.runListeners("select");
    //addAuthorSearchAndSelect(s);
  }

  public async showAuthorFromPopupMenu(ev: Event) {
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
    this.showAuthorByID(id);
  }
}

// async function addAuthorSearchAndSelect(s: Zotero.Search) {
//   if (ZoteroPane.collectionsView) {
//     let startRow =
//       ZoteroPane.collectionsView._rowMap["L" + Zotero.Libraries.userLibraryID];
//     const level = ZoteroPane.collectionsView.getLevel(startRow) + 1;
//     let beforeRow;
//     let hasTemporarySearchHeader = false;
//     if (ZoteroPane.collectionsView.isContainerEmpty(startRow)) {
//       beforeRow = startRow + 1;
//     } else {
//       startRow++;
//       for (let i = startRow; i < ZoteroPane.collectionsView._rows.length; i++) {
//         const treeRow = ZoteroPane.collectionsView.getRow(i);
//         beforeRow = i;
//         if (treeRow.isHeader() && treeRow.ref.id == "temporary-search") {
//           beforeRow++;
//           hasTemporarySearchHeader = true;
//           break;
//         }
//         // If it's not a search and it's not a collection, stop
//         if (!treeRow.isCollection() && !treeRow.isSearch()) {
//           break;
//         }
//       }
//     }
//     if (hasTemporarySearchHeader) {
//       for (
//         let i = beforeRow;
//         i < ZoteroPane.collectionsView._rows.length;
//         i++
//       ) {
//         const treeRow = ZoteroPane.collectionsView.getRow(i);
//         if (!treeRow.isSearch()) {
//           break;
//         }
//         if (treeRow.ref.name == s.name) {
//           ZoteroPane.collectionsView.selectItem(treeRow.id);
//           return;
//         }
//       }
//     }
//     const parentNode = new Zotero.CollectionTreeRow(
//       ZoteroPane.collectionsView,
//       "header",
//       {
//         id: "temporary-search",
//         label: Zotero.getString("temporary-search"),
//         libraryID: -1,
//       },
//       level,
//     );
//     ZoteroPane.collectionsView._addRow(parentNode, beforeRow);
//     beforeRow++;
//     const newTreeRow = new Zotero.CollectionTreeRow(
//       ZoteroPane.collectionsView,
//       "search",
//       s,
//       level + 1,
//       true,
//     );
//     ZoteroPane.collectionsView._addRow(newTreeRow, beforeRow);
//     ztoolkit.getGlobal("alert")(newTreeRow.id);
//     ZoteroPane.collectionsView.selectItem(newTreeRow.id);
//   }
// }

export { AuthorBrowserAddon };
