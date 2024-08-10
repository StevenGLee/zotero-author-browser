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
        multiSelect: false,
        staticColumns: false,
        disableFontSizeScaling: true,
      })
      .setProp("getRowCount", () => addon.data.manager.data.length)
      .setProp("getRowData", (index) => ({
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
    renameButton.disabled = true;
    renameButton.addEventListener("click", async (ev) => {
      refresh();
    });
    aliasButton.disabled = true;
    aliasButton.addEventListener("click", (ev) => {
      refresh();
    });

    swapButton.addEventListener("click", () => {
      swapNames();
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

const sortDataKeys = ["firstName", "lastName", "itemCount"] as Array<
  keyof CreatorDataRow
>;

async function quickSort() {
  const sortKey = sortDataKeys[addon.data.manager.columnIndex];
  addon.data.manager.data.sort((a, b) => {
    if (!a || !b) {
      return 0;
    }
    const valueA = String(a[sortKey] || "");
    const valueB = String(b[sortKey] || "");
    return addon.data.manager.columnAscending
      ? valueA.localeCompare(valueB)
      : valueB.localeCompare(valueA);
  });

  await updateTable();
  updateButtons();
}

async function updateData() {
  const sortKey = sortDataKeys[addon.data.manager.columnIndex];
  addon.data.manager.data = (await getAllCreators()).sort((a, b) => {
    if (!a || !b) {
      return 0;
    }
    const valueA = String(a[sortKey] || "");
    const valueB = String(b[sortKey] || "");
    return addon.data.manager.columnAscending
      ? valueA.localeCompare(valueB)
      : valueB.localeCompare(valueA);
  });
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
async function swapNames() {
  const creatorID = getSelectedNoteIds();
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
