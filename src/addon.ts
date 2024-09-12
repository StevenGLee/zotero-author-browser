import { VirtualizedTableHelper } from "zotero-plugin-toolkit/dist/helpers/virtualizedTable";
import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { CreatorDataRow } from "./modules/authorBrowserAddon";

export interface AuthorAliases {
  aliasedCreatorIDs: Array<number>;
  aliases: Array<{
    mainID: number;
    aliasIDs: Array<number>;
  }>;
}

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
      renameDialog?;
      aliasEditor: {
        window?: Window;
        nonAliastableHelper?: VirtualizedTableHelper;
        aliastableHelper?: VirtualizedTableHelper;
        nonAliasTableData: CreatorDataRow[];
        aliasTableData: number[];
        columnIndex: number;
        columnAscending: boolean;
      };
    };
    authorAliases: AuthorAliases;
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
        aliasEditor: {
          nonAliasTableData: [],
          aliasTableData: [],
          columnIndex: 0,
          columnAscending: true,
        },
      },
      authorAliases: {
        aliasedCreatorIDs: [],
        aliases: [],
      },
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
