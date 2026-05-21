/// @ts-nocheck
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { isWindowAlive } from "../utils/window";
import { getAllCreators, showAuthorByID } from "./authorBrowserAddon";

export async function onDialog() {
  if (isWindowAlive(addon.data.manager.aliasEditor.window)) {
    addon.data.manager.aliasEditor.window?.focus();
    await refresh();
    return;
  }

  const windowArgs = {
    _initPromise: Zotero.Promise.defer(),
  };
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/AliasEditor.xhtml`,
    `${config.addonRef}-allAuthorWindow`,
    `chrome,centerscreen,resizable,status,dialog=yes`,
    windowArgs,
  )!;
  await windowArgs._initPromise.promise;
  addon.data.manager.aliasEditor.window = win;
  addon.data.manager.aliasEditor.nonAliastableHelper = new ztoolkit.VirtualizedTable(
    win!,
  )
    .setContainerId("non-alias-table-container")
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
    .setProp("onSelectionChange", () => {
      updateButtons();
    })
    .setProp("onActivate", () => {
      const creatorID = getSelectedNoteIds(
        addon.data.manager.aliasEditor.nonAliastableHelper,
      );
      if (creatorID > 0) {
        showAuthorByID(creatorID);
      }
      return true;
    })
    .setProp("onColumnSort", (columnIndex, ascending) => {
      addon.data.manager.aliasEditor.columnIndex = columnIndex;
      addon.data.manager.aliasEditor.columnAscending = ascending > 0;
      quickSort();
    })
    .render();

  addon.data.manager.aliasEditor.aliastableHelper = new ztoolkit.VirtualizedTable(
    win!,
  )
    .setContainerId("alias-table-container")
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
      firstName: addon.data.manager.data[index].firstName,
      lastName: addon.data.manager.data[index].lastName,
      itemCount: String(addon.data.manager.data[index].itemCount),
    }))
    .setProp("onSelectionChange", () => {
      updateButtons();
    })
    .setProp("onActivate", () => {
      const creatorID = getSelectedNoteIds(
        addon.data.manager.aliasEditor.aliastableHelper,
      );
      if (creatorID > 0) {
        showAuthorByID(creatorID);
      }
      return true;
    })
    .setProp("onColumnSort", (columnIndex, ascending) => {
      addon.data.manager.aliasEditor.columnIndex = columnIndex;
      addon.data.manager.aliasEditor.columnAscending = ascending > 0;
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

  refreshButton.addEventListener("click", async () => {
    await refresh();
  });
  renameButton.disabled = true;
  renameButton.addEventListener("click", async () => {
    await refresh();
  });
  aliasButton.disabled = true;
  aliasButton.addEventListener("click", async () => {
    await refresh();
  });

  swapButton.addEventListener("click", async () => {
    await swapNames();
    await refresh();
  });
  fixCapssButton.addEventListener("click", async () => {
    await capitalizeCreatorName();
    await refresh();
  });
  showItemsButton.addEventListener("click", () => {
    const creatorID = getSelectedNoteIds();
    if (creatorID > 0) {
      showAuthorByID(creatorID);
    }
  });

  await refresh();
}

const sortDataKeys = ["firstName", "lastName", "itemCount"];

async function quickSort() {
  const sortKey = sortDataKeys[addon.data.manager.aliasEditor.columnIndex];
  addon.data.manager.data.sort((a, b) => {
    if (!a || !b) {
      return 0;
    }
    const valueA = String(a[sortKey] || "");
    const valueB = String(b[sortKey] || "");
    return addon.data.manager.aliasEditor.columnAscending
      ? valueA.localeCompare(valueB)
      : valueB.localeCompare(valueA);
  });

  await updateTable();
  updateButtons();
}

async function updateData() {
  const sortKey = sortDataKeys[addon.data.manager.aliasEditor.columnIndex];
  addon.data.manager.data = await getAllCreators(
    sortKey,
    addon.data.manager.aliasEditor.columnAscending == false,
  );
}
function updateButtons() {
  const win = addon.data.manager.aliasEditor.window;
  if (!win) {
    return;
  }
  const fixCapssButton = win.document.querySelector(
    "#fix-caps",
  ) as HTMLButtonElement;
  const creatorID = getSelectedNoteIds();
  fixCapssButton.disabled =
    creatorID <= 0 || !canCapitalizeCreatorName(creatorID);
}

async function renderTable(tableHelper: any) {
  return new Promise<void>((resolve) => {
    if (!tableHelper) {
      resolve();
      return;
    }
    tableHelper.render(undefined, () => {
      resolve();
    });
  });
}

async function updateTable() {
  await Promise.all([
    renderTable(addon.data.manager.aliasEditor.nonAliastableHelper),
    renderTable(addon.data.manager.aliasEditor.aliastableHelper),
  ]);
}

async function refresh() {
  await updateData();
  await updateTable();
  updateButtons();
}

function getSelectedNoteIdsFromTable(tableHelper: any) {
  let id: number = -1;
  for (const idx of tableHelper?.treeInstance.selection.selected?.keys() ||
    []) {
    id = addon.data.manager.data[idx].creatorID;
  }
  return id;
}

function getSelectedNoteIds(preferredTableHelper?: any) {
  const preferredID = getSelectedNoteIdsFromTable(preferredTableHelper);
  if (preferredID > 0) {
    return preferredID;
  }
  const nonAliasID = getSelectedNoteIdsFromTable(
    addon.data.manager.aliasEditor.nonAliastableHelper,
  );
  if (nonAliasID > 0) {
    return nonAliasID;
  }
  return getSelectedNoteIdsFromTable(addon.data.manager.aliasEditor.aliastableHelper);
}

async function swapNames() {
  const creatorID = getSelectedNoteIds();
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
}
