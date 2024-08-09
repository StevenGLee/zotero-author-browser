import { config } from "../../package.json";
import { getLocaleID, getString } from "../utils/locale";
export class AuthorBrowserDialog {
  static async onDialog() {
    const authorList = {
      columns: [
        {
          dataKey: "firstName",
          label: "firstName",
          fixedWidth: true,
          width: 100,
        },
        {
          dataKey: "lastName",
          label: "lastName",
          fixedWidth: true,
          width: 100,
        },
        {
          dataKey: "itemCount",
          label: "itemCount",
          fixedWidth: true,
          width: 100,
        },
      ],
      rows: [],
    };
    authorList.rows = await addon.authorBrowserAddon.getAllCreators();
    const renderLock = ztoolkit.getGlobal("Zotero").Promise.defer();
    const dialogHelper = new ztoolkit.Dialog(10, 2);
    dialogHelper.open("Dialog Example");
    const tableHelper = new ztoolkit.VirtualizedTable(dialogHelper.window)
      .setContainerId(`${config.addonRef}-table-container`)
      .setProp({
        id: `${config.addonRef}-prefs-table`,
        // Do not use setLocale, as it modifies the Zotero.Intl.strings
        // Set locales directly to columns
        columns: authorList.columns,
        showHeader: true,
        multiSelect: true,
        staticColumns: true,
        disableFontSizeScaling: true,
      })
      .setProp("getRowCount", () => authorList.rows.length || 0)
      .setProp(
        "getRowData",
        (index) =>
          authorList.rows[index] || {
            firstName: "",
            lastName: "",
            creatorID: -1,
            itemCounts: 0,
          },
      )
      .setProp("onActivate", (event) => {
        const id =
          authorList.rows[tableHelper.treeInstance.selection.focused].creatorId;
        addon.authorBrowserAddon.showAuthorByID(id);
        document.getElementById("");
        return false;
      })
      .render(-1, () => {
        renderLock.resolve();
      });
  }

  //   public async addAuthorList() {
  //     if(ZoteroPane.collectionsView)
  //     {
  //     let startRow =
  //       ZoteroPane.collectionsView._rowMap["L" + Zotero.Libraries.userLibraryID];
  //     const level = ZoteroPane.collectionsView.getLevel(startRow) + 1;
  //     let beforeRow;
  //     if (ZoteroPane.collectionsView.isContainerEmpty(startRow)) {
  //       beforeRow = startRow + 1;
  //     } else {
  //       startRow++;
  //       for (let i = startRow; i < ZoteroPane.collectionsView._rows.length; i++) {
  //         const treeRow = ZoteroPane.collectionsView.getRow(i);
  //         beforeRow = i;

  //         // If we've reached something other than collections, stop
  //         if (treeRow.isSearch()) {
  //           break;
  //         }
  //         // If it's not a search and it's not a collection, stop
  //         else if (!treeRow.isCollection()) {
  //           break;
  //         }
  //       }
  //     }
  //     const parentSearch = new Zotero.Search({
  //       name: Zotero.getString("pane.collections.groupLibraries"),
  //       libraryID: Zotero.Libraries.userLibraryID,
  //     });

  //     const parentNode = new Zotero.CollectionTreeRow(
  //       ZoteroPane.collectionsView,
  //       "search",
  //       parentSearch,
  //       level,
  //       false,
  //     );
  //     ZoteroPane.collectionsView._addRow(parentNode, beforeRow);

  //     for (let i = 0; i < rows.length; i++) {
  //       beforeRow++;
  //       const row = rows[i];
  //       const fullName = row.firstName + " " + row.lastName;
  //       const s = new Zotero.Search({
  //         name: fullName,
  //         libraryID: Zotero.Libraries.userLibraryID,
  //       });
  //       s.name = fullName;
  //       s.addCondition("joinMode", "any");
  //       s.addCondition("creator", "is", fullName);
  //       s.parentID = parentSearch.id;
  //       ZoteroPane.collectionsView._addRow(
  //         new Zotero.CollectionTreeRow(
  //           ZoteroPane.collectionsView,
  //           "search",
  //           s,
  //           level + 1,
  //           true,
  //         ),
  //         beforeRow,
  //       );
  //     }}
  //   }
}
