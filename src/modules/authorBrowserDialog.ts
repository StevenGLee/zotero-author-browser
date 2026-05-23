/// @ts-nocheck
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { isWindowAlive } from "../utils/window";
import {
  showAuthorByID,
  getAllCreators,
  searchAuthorInGoogleScholarByID,
  searchAuthorInCNKIByID,
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
      .setProp("onItemContextMenu", (ev, x, y) => {
        showAuthorListContextMenu(ev, x, y);
        return true;
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
    const searchScholarButton = win.document.querySelector(
      "#search-scholar",
    ) as HTMLButtonElement;
    const searchCNKIButton = win.document.querySelector(
      "#search-cnki",
    ) as HTMLButtonElement;
    const searchScholarContextMenuItem = win.document.querySelector(
      "#search-scholar-context",
    ) as XUL.MenuItem;
    const searchCNKIContextMenuItem = win.document.querySelector(
      "#search-cnki-context",
    ) as XUL.MenuItem;
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
    searchScholarButton.addEventListener("click", () => {
      openScholarForSelection();
    });
    searchCNKIButton.addEventListener("click", () => {
      openCNKIForSelection();
    });
    searchScholarContextMenuItem?.addEventListener("command", () => {
      openScholarForSelection();
    });
    searchCNKIContextMenuItem?.addEventListener("command", () => {
      openCNKIForSelection();
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
  const searchScholarButton = win.document.querySelector(
    "#search-scholar",
  ) as HTMLButtonElement;
  const searchCNKIButton = win.document.querySelector(
    "#search-cnki",
  ) as HTMLButtonElement;
  const searchScholarContextMenuItem = win.document.querySelector(
    "#search-scholar-context",
  ) as XUL.MenuItem;
  const searchCNKIContextMenuItem = win.document.querySelector(
    "#search-cnki-context",
  ) as XUL.MenuItem;

  renameButton.disabled = creatorID <= 0;
  aliasButton.disabled = creatorID <= 0;
  swapButton.disabled = creatorID <= 0;
  showItemsButton.disabled = creatorID <= 0;
  searchScholarButton.disabled = creatorID <= 0;
  searchCNKIButton.disabled = creatorID <= 0;
  if (searchScholarContextMenuItem) {
    searchScholarContextMenuItem.disabled = creatorID <= 0;
  }
  if (searchCNKIContextMenuItem) {
    searchCNKIContextMenuItem.disabled = creatorID <= 0;
  }
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

export function openScholarForSelection() {
  const creatorID = getSelectedNoteIds();
  if (creatorID <= 0) {
    return;
  }
  searchAuthorInGoogleScholarByID(creatorID);
}

export function openCNKIForSelection() {
  const creatorID = getSelectedNoteIds();
  if (creatorID <= 0) {
    return;
  }
  searchAuthorInCNKIByID(creatorID);
}

function showAuthorListContextMenu(ev: Event, x: number, y: number) {
  const win = addon.data.manager.window;
  if (!win) {
    return;
  }
  const rawEvent = ev as any;
  rawEvent?.preventDefault?.();
  rawEvent?.stopPropagation?.();
  selectRowFromContextMenuEvent(ev);
  updateButtons();
  const popup = win.document.querySelector(
    "#author-list-context-menu",
  ) as XULPopupElement | null;
  if (!popup || typeof popup.openPopupAtScreen !== "function") {
    return;
  }
  const screenX =
    Number.isFinite(Number(x)) && Number(x) >= 0
      ? Number(x)
      : Number(rawEvent?.screenX) || 0;
  const screenY =
    Number.isFinite(Number(y)) && Number(y) >= 0
      ? Number(y)
      : Number(rawEvent?.screenY) || 0;
  popup.openPopupAtScreen(screenX, screenY, true);
}

function selectRowFromContextMenuEvent(ev: Event) {
  const tableHelper = addon.data.manager.tableHelper;
  const selection = tableHelper?.treeInstance?.selection;
  if (!selection || typeof selection.select !== "function") {
    return;
  }

  const rowIndex = getRowIndexFromContextMenuEvent(ev);
  if (
    Number.isInteger(rowIndex) &&
    rowIndex >= 0 &&
    rowIndex < addon.data.manager.data.length
  ) {
    selection.select(rowIndex);
  }
}

function getRowIndexFromContextMenuEvent(ev: Event) {
  const rawEvent = ev as any;
  const directIndexCandidates = [
    rawEvent?.index,
    rawEvent?.row,
    rawEvent?.rowIndex,
  ];
  for (const candidate of directIndexCandidates) {
    const parsedCandidate = Number(candidate);
    if (Number.isInteger(parsedCandidate) && parsedCandidate >= 0) {
      return parsedCandidate;
    }
  }

  const target = rawEvent?.target as Element | null;
  if (!target || typeof target.closest !== "function") {
    return -1;
  }

  const containers: Array<Element> = [];
  const closestWithKnownAttr = target.closest(
    "[data-row-index], [data-row], [data-index]",
  );
  if (closestWithKnownAttr) {
    containers.push(closestWithKnownAttr);
  }
  const closestRow = target.closest('[role="row"], .row');
  if (closestRow) {
    containers.push(closestRow);
  }

  for (const container of containers) {
    const attrCandidates = [
      container.getAttribute("data-row-index"),
      container.getAttribute("data-row"),
      container.getAttribute("data-index"),
      (container as any).dataset?.rowIndex,
      (container as any).dataset?.row,
      (container as any).dataset?.index,
    ];
    for (const attrValue of attrCandidates) {
      const parsedAttrValue = Number(attrValue);
      if (Number.isInteger(parsedAttrValue) && parsedAttrValue >= 0) {
        return parsedAttrValue;
      }
    }
  }

  return -1;
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
