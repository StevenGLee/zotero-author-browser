import { VirtualizedTableHelper } from "zotero-plugin-toolkit/dist/helpers/virtualizedTable";
import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { AuthorBrowserAddon } from "./modules/authorBrowserAddon";
import { CreatorDataRow } from "./modules/authorBrowserAddon";

class Addon {
  public data: {
    alive: boolean;
    // Env type, see build.js
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    manager: {
      window?: Window;
      tableHelper?: VirtualizedTableHelper;
      data: CreatorDataRow[];
      columnIndex: number;
      columnAscending: boolean;
    };
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;
  public authorBrowserAddon: AuthorBrowserAddon;

  constructor() {
    this.data = {
      alive: true,
      env: __env__,
      ztoolkit: createZToolkit(),
      manager: {
        data: [],
        columnAscending: false,
        columnIndex: 2,
      },
    };
    this.hooks = hooks;
    this.api = {};
    this.authorBrowserAddon = new AuthorBrowserAddon();
  }
}

export default Addon;
