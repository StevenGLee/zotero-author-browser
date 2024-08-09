import { getString, initLocale } from "../utils/locale";
import { AuthorBrowserDialog } from "./authorBrowserDialog";

class AuthorBrowserAddon {
  static registerToolsMenuItem() {
    ztoolkit.Menu.register("menuTools", {
      tag: "menuitem",
      id: "author-browser-tool-menu-item",
      label: getString("author-browser-tool-menu-item-label"),
      commandListener: (ev) => AuthorBrowserDialog.onDialog(),
    });
  }
  private db: Zotero.DBConnection;

  static registerCreatorTransformMenuItem() {
    // const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
    // item menuitem with icon
    ztoolkit.Menu.register(
      ztoolkit.Menu.getGlobal("document").querySelector(
        "#zotero-creator-transform-menu",
      ),
      {
        tag: "menuseparator",
      },
    );
    ztoolkit.Menu.register(
      ztoolkit.Menu.getGlobal("document").querySelector(
        "#zotero-creator-transform-menu",
      ),
      {
        tag: "menuitem",
        id: "zotero-show-author",
        label: getString("show-author"),
        commandListener: async (ev) =>
          addon.authorBrowserAddon.showAuthorFromPopupMenu(ev),
        // icon: menuIcon,
      },
    );
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

    const creators = [];
    await Zotero.DB.executeTransaction(async function () {
      let rows;
      rows = await doGetAllCreators();
      for (let i = 0; i < rows.length; i++) {
        creators.push({
          firstName: rows[i].firstName,
          lastName: rows[i].lastName,
          creatorID: rows[i].creatorID,
          itemCounts: await Zotero.Creators.countItemAssociations(
            rows[i].creatorID,
          ),
        });
      }
    });

    return creators;
  }

  public async getCreatorMainID(id: number) {
    const doGetCreatorMainID = Zotero.Promise.coroutine(function* (creatorID) {
      this.db.requireTransaction();
      const sql =
        "SELECT mainID FROM creatorAlias WHERE aliasID = " + creatorID;
      const result = yield this.db.valueQueryAsync(sql);
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
      creatorAliases = await doGetAllAliasByMainID(id);
    });
    if (!creatorAliases) {
      creatorAliases = [mainId];
    }
    return creatorAliases;
  }

  public showAuthorByID(id: number) {
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
        await Zotero.Libraries.get(
          Zotero.Libraries.userLibraryID,
        ).waitForDataLoad("item");
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
    itemsView.changeCollectionTreeRow(collectionTreeRow);
    ZoteroPane.collectionsView.selection.clearSelection();
    document.getElementById("item-tree-main-default").focus();
  }

  public async showAuthorFromPopupMenu(ev: Event) {
    const row = ev.target.ownerDocument.popupNode.closest(".meta-row");
    const fields = ZoteroPane.itemPane
      .querySelector("item-box")
      .getCreatorFields(row);
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

export { AuthorBrowserAddon };
