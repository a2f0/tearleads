import type { DocumentRow } from "@symcrypt/client-sdk";
import { useCallback, useEffect, useState } from "react";

// A row-cell edit is committed to the document store asynchronously (it rides a
// Loro write + IndexedDB persist), so a controlled input bound directly to the
// re-derived snapshot would lag a keystroke and jump the caret. This hook keeps
// a thin optimistic overlay of in-flight cell values: the input reads the
// staged value immediately, and each entry clears itself once the store row
// catches up (or the row disappears). Cells with no staged edit fall through to
// the live store value, so remote edits to other cells still surface.
export function useDocumentRowEditing(rows: ReadonlyArray<DocumentRow>) {
  // Overlay entries are keyed "<rowId>:<field>". Row ids are UUIDs / "row-…"
  // slugs and field names are fixed identifier consts, so neither contains a
  // colon and splitting on the first ":" is unambiguous.
  const [pendingCells, setPendingCells] = useState<Record<string, string>>({});

  useEffect(() => {
    setPendingCells((previous) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [cellKey, stagedValue] of Object.entries(previous)) {
        const separator = cellKey.indexOf(":");
        const id = cellKey.slice(0, separator);
        const field = cellKey.slice(separator + 1);
        const row = rows.find((candidate) => candidate.id === id);
        if (row && (row.fields[field] ?? "") !== stagedValue) {
          next[cellKey] = stagedValue;
        } else {
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [rows]);

  const readCell = useCallback(
    (id: string, field: string, storeValue: string): string => {
      const stagedValue = pendingCells[`${id}:${field}`];
      return stagedValue === undefined ? storeValue : stagedValue;
    },
    [pendingCells],
  );

  const stageCell = useCallback(
    (id: string, field: string, value: string): void => {
      setPendingCells((previous) => ({
        ...previous,
        [`${id}:${field}`]: value,
      }));
    },
    [],
  );

  const clearRow = useCallback((id: string): void => {
    setPendingCells((previous) => {
      const prefix = `${id}:`;
      let changed = false;
      const next: Record<string, string> = {};
      for (const [cellKey, stagedValue] of Object.entries(previous)) {
        if (cellKey.startsWith(prefix)) {
          changed = true;
        } else {
          next[cellKey] = stagedValue;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  return { clearRow, readCell, stageCell };
}
