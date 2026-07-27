import { useMiniAppColumnVisibility } from "../../../../components/mini-app/MiniAppTable";
import {
  BLOB_INFO_TOGGLEABLE_COLUMN_IDS,
  type BlobInfoColumnId,
} from "./blobListColumns";

/*
 * Which blob-list columns a user has turned off. A stored preference is the
 * *complete* hidden set, so a column that becomes hidden-by-default has to be
 * added to the sets already saved — otherwise the new default would only ever
 * reach users who had never opened the columns menu. Hence a key per generation
 * of the defaults.
 */
const STORAGE_KEY = "tearleads.blob-browser:hidden-columns:v3";

// Two dimensions the list can show but does not lead with: attribution, which
// only a multi-organization user reads, and the sync badge, whose narrow glyph
// would otherwise take an equal share of a folded row's second line and leave
// the fields beside it squeezed short of the row's trailing edge.
const DEFAULT_HIDDEN_COLUMN_IDS: ReadonlyArray<BlobInfoColumnId> = [
  "organization",
  "sync",
];

export function useBlobInfoColumnVisibility() {
  return useMiniAppColumnVisibility<BlobInfoColumnId>({
    defaultHiddenColumnIds: DEFAULT_HIDDEN_COLUMN_IDS,
    storageKey: STORAGE_KEY,
    toggleableColumnIds: BLOB_INFO_TOGGLEABLE_COLUMN_IDS,
  });
}
