import { VirtualizedTableHelper } from "zotero-plugin-toolkit/dist/helpers/virtualizedTable";
import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
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
    // @ts-ignore
    db: Zotero.DBConnection;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

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
      db: null,
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
