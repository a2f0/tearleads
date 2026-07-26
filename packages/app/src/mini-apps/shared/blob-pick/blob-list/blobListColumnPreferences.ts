import { useState } from "react";
import { useMiniAppColumnVisibility } from "../../../../components/mini-app/MiniAppTable";
import {
  BLOB_INFO_TOGGLEABLE_COLUMN_IDS,
  type BlobInfoColumnId,
} from "./blobListColumns";

/*
 * Which blob-list columns a user has turned off, and how a saved answer survives
 * a change to what "off by default" means.
 *
 * A stored preference is the *complete* hidden set, so a column that becomes
 * hidden-by-default has to be added to the sets already saved — otherwise the new
 * default would only ever reach users who had never opened the columns menu.
 * Hence a key per generation of the defaults, and a migration that carries the
 * user's own choices forward across them.
 */
const LEGACY_STORAGE_KEY = "tearleads.explorer.blob-browser:hidden-columns";
const V2_STORAGE_KEY = "tearleads.blob-browser:hidden-columns:v2";
const STORAGE_KEY = "tearleads.blob-browser:hidden-columns:v3";

// Two dimensions the list can show but does not lead with: attribution, which
// only a multi-organization user reads, and the sync badge, whose narrow glyph
// would otherwise take an equal share of a folded row's second line and leave
// the fields beside it squeezed short of the row's trailing edge.
const DEFAULT_HIDDEN_COLUMN_IDS: ReadonlyArray<BlobInfoColumnId> = [
  "organization",
  "sync",
];

function readStoredColumnIds(
  storage: Pick<Storage, "getItem">,
  key: string,
): Set<BlobInfoColumnId> | null {
  const stored = storage.getItem(key);
  if (stored === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) {
    return null;
  }

  return new Set(
    parsed.filter(
      (value): value is BlobInfoColumnId =>
        typeof value === "string" &&
        BLOB_INFO_TOGGLEABLE_COLUMN_IDS.some((id) => id === value),
    ),
  );
}

/**
 * Rewrites the newest generation of the preference from the newest one the user
 * actually has, adding each default that has changed since it was written.
 *
 * Idempotent, including under React Strict Mode: the current key existing is
 * itself the "already migrated" answer, and a user with no saved preference at
 * all writes nothing and simply takes {@link DEFAULT_HIDDEN_COLUMN_IDS}.
 */
function migrateBlobInfoColumnVisibility(): void {
  try {
    const storage = globalThis.localStorage;
    if (storage.getItem(STORAGE_KEY) !== null) {
      return;
    }
    const stored = readStoredColumnIds(storage, V2_STORAGE_KEY);
    const hiddenColumns =
      stored ?? readStoredColumnIds(storage, LEGACY_STORAGE_KEY);
    if (!hiddenColumns) {
      return;
    }
    if (!stored) {
      // v1 -> v2: Organization did not exist when a v1 preference was saved, so
      // keep the new dimension hidden until the user explicitly enables it.
      hiddenColumns.add("organization");
    }
    // v2 -> v3: the sync badge gave up its slot so a folded row's two lines can
    // use the full width of the row.
    hiddenColumns.add("sync");
    storage.setItem(STORAGE_KEY, JSON.stringify([...hiddenColumns]));
  } catch {
    // Column visibility is a display preference; disabled storage is harmless.
  }
}

export function useBlobInfoColumnVisibility() {
  // The lazy initializer runs before the generic visibility hook reads the
  // current key. The migration is idempotent, including under React Strict Mode.
  useState(() => migrateBlobInfoColumnVisibility());
  return useMiniAppColumnVisibility<BlobInfoColumnId>({
    defaultHiddenColumnIds: DEFAULT_HIDDEN_COLUMN_IDS,
    storageKey: STORAGE_KEY,
    toggleableColumnIds: BLOB_INFO_TOGGLEABLE_COLUMN_IDS,
  });
}
