import { config } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import {
  registerCreatorTransformMenuItem,
  registerToolsMenuItem,
  deleteABSavedSearches,
} from "./modules/authorBrowserAddon";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  // @ts-ignore This is a moz feature
  window.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);

  registerCreatorTransformMenuItem();
  registerToolsMenuItem();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  deleteABSavedSearches();
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();

  deleteABSavedSearches();
  // Remove addon object
  addon.data.alive = false;
  delete Zotero[config.addonInstance];
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
