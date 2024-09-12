/// @ts-nocheck
import { config } from "../../package.json";
import { getLocaleID, getString } from "../utils/locale";
import { isWindowAlive } from "../utils/window";
import {
  showAuthorByID,
  CreatorDataRow,
  getAllCreators,
} from "./authorBrowserAddon";

export async function onDialog() {
  refresh();

  if (isWindowAlive(addon.data.manager.window)) {
    addon.data.manager.window?.focus();
    // refresh();
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
    // updateData();
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
      }))
      .setProp("onSelectionChange", (selection) => {
        updateButtons();
      })
      .setProp("onActivate", (ev) => {
        showAuthorByID(getSelectedNoteIds());
        return true;
      })
      .setProp("onColumnSort", (columnIndex, ascending) => {
        addon.data.manager.columnIndex = columnIndex;
        addon.data.manager.columnAscending = ascending > 0;
        quickSort();
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
    const swapButton = win.document.querySelector("#swap") as HTMLButtonElement;
    const fixCapssButton = win.document.querySelector(
      "#fix-caps",
    ) as HTMLButtonElement;
    const showItemsButton = win.document.querySelector(
      "#show-item",
    ) as HTMLButtonElement;
    refreshButton.addEventListener("click", (ev) => {
      refresh();
    });
    renameButton.addEventListener("click", async (ev) => {
      const creatorID = getSelectedNoteIds();
      await remnameDialog(creatorID);
      refresh();
    });
    aliasButton.disabled = true;
    aliasButton.addEventListener("click", (ev) => {
      refresh();
    });
    swapButton.addEventListener("click", () => {
      const creatorID = getSelectedNoteIds();
      swapNames(creatorID);
      refresh();
    });
    fixCapssButton.addEventListener("click", () => {
      capitalizeCreatorName();
    });
    showItemsButton.addEventListener("click", () => {
      showAuthorByID(getSelectedNoteIds());
    });
  }
}

const sortDataKeys = ["creatorID", "firstName", "lastName", "itemCount"];

async function quickSort() {
  const sortKey = sortDataKeys[addon.data.manager.columnIndex];
  addon.data.manager.data.sort((a, b) => {
    if (!a || !b) {
      return 0;
    }
    if(sortKey == "itemCount" || sortKey == "creatorID")
    {
      const valueA = Number(a[sortKey] || 0);
    const valueB = Number(b[sortKey] || 0);
    return addon.data.manager.columnAscending
      ? valueA>valueB
      : valueB>valueA;
    }
    else{
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
  addon.data.manager.data = (await getAllCreators(sortKey, addon.data.manager.columnAscending == false));
}
function updateButtons() {
  const win = addon.data.manager.window;
  if (!win) {
    return;
  }
  const fixCapssButton = win.document.querySelector(
    "#fix-caps",
  ) as HTMLButtonElement;
  if (canCapitalizeCreatorName(getSelectedNoteIds())) {
    fixCapssButton.disabled = false;
  } else {
    fixCapssButton.disabled = true;
  }
}
async function updateTable() {
  return new Promise<void>((resolve) => {
    addon.data.manager.tableHelper?.render(undefined, (_) => {
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
  let id: number = -1;
  for (const idx of addon.data.manager.tableHelper?.treeInstance.selection.selected?.keys() ||
    []) {
    id = addon.data.manager.data[idx].creatorID;
  }
  return id;
}
async function swapNames(creatorID: number) {
  const fields = Zotero.Creators.get(creatorID);
  const lastName = fields.lastName;
  const firstName = fields.firstName;
  fields.lastName = firstName;
  fields.firstName = lastName;
  Zotero.Creators.updateCreator(creatorID, fields);
}

function canCapitalizeCreatorName(creatorID: number) {
  const fields = Zotero.Creators.get(creatorID);
  return (
    (fields.firstName &&
      Zotero.Utilities.capitalizeName(fields.firstName) != fields.firstName) ||
    (fields.lastName &&
      Zotero.Utilities.capitalizeName(fields.lastName) != fields.lastName)
  );
}

async function capitalizeCreatorName() {
  const creatorID = getSelectedNoteIds();
  const fields = Zotero.Creators.get(creatorID);
  fields.lastName = Zotero.Utilities.capitalizeName(fields.lastName);
  fields.firstName = Zotero.Utilities.capitalizeName(fields.firstName);
  Zotero.Creators.updateCreator(creatorID, fields);
}

export async function remnameDialog(creatorID: number) {
  const creator = Zotero.Creators.get(creatorID);
  const dialogData: { [key: string | number]: any } = {
    creatorID: creatorID,
    firstName: creator.firstName,
    lastName: creator.lastName,
  };
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
    creator.firstName = dialogData.firstName;
    creator.lastName = dialogData.lastName;
    creator.save();
  }
  if (dialogData._lastButtons) addon.data.manager.renameDialog = undefined;
}
