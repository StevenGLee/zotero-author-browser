/// @ts-nocheck
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { isWindowAlive } from "../utils/window";
import {
  showAuthorByID,
  getAllCreators,
} from "./authorBrowserAddon";
import { onDialog as onAliasEditorDialog } from "./aliasEditor";

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
        aliasFullNames: addon.data.manager.data[index].aliasFullNamesString,
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
  if (!win) {
    return;
  }
  const creatorID = getSelectedNoteIds();
  const fixCapssButton = win.document.querySelector(
    "#fix-caps",
  ) as HTMLButtonElement;
  const aliasButton = win.document.querySelector("#alias") as HTMLButtonElement;
  const renameButton = win.document.querySelector(
    "#rename",
  ) as HTMLButtonElement;
  const swapButton = win.document.querySelector("#swap") as HTMLButtonElement;
  const showItemsButton = win.document.querySelector(
    "#show-item",
  ) as HTMLButtonElement;

  renameButton.disabled = creatorID <= 0;
  aliasButton.disabled = creatorID <= 0;
  swapButton.disabled = creatorID <= 0;
  showItemsButton.disabled = creatorID <= 0;
  fixCapssButton.disabled =
    creatorID <= 0 || !canCapitalizeCreatorName(creatorID);
}
async function updateTable() {
  return new Promise<void>((resolve) => {
    if (!addon.data.manager.tableHelper) {
      resolve();
      return;
    }
    addon.data.manager.tableHelper.render(undefined, (_) => {
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
