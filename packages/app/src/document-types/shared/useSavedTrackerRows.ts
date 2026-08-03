import { useCallback, useMemo, useState } from "react";

export type AddTrackerRow<Entry> = (entry: Entry) => Promise<string | null>;

interface SavedTrackerRowState {
  readonly overrides: ReadonlyMap<string, boolean>;
  readonly unknownRowsAreSaved: boolean;
}

/**
 * Tracks which rows have been individually saved during an edit session.
 * Targeted sessions default every row except the selected one to read mode,
 * including rows that arrive later through sync. Full-document sessions do
 * the inverse, so existing and newly-arriving rows remain editable until they
 * are explicitly saved.
 */

export function useSavedTrackerRows(
  rows: ReadonlyArray<{ readonly id: string }>,
  initialEditingRowId: string | null,
) {
  const [state, setState] = useState<SavedTrackerRowState>(() => {
    const hasEditingRow =
      initialEditingRowId !== null &&
      rows.some((row) => row.id === initialEditingRowId);

    return {
      overrides: hasEditingRow
        ? new Map([[initialEditingRowId, false]])
        : new Map(),
      unknownRowsAreSaved: hasEditingRow,
    };
  });
  const savedRowIds = useMemo(
    () =>
      new Set(
        rows
          .filter(
            (row) => state.overrides.get(row.id) ?? state.unknownRowsAreSaved,
          )
          .map((row) => row.id),
      ),
    [rows, state],
  );
  const setRowSaved = useCallback((id: string, saved: boolean) => {
    setState((current) => {
      const overrides = new Map(current.overrides);
      overrides.set(id, saved);
      return { ...current, overrides };
    });
  }, []);
  const saveAddedRow = useCallback(
    async (addedRow: Promise<string | null>) => {
      const id = await addedRow;
      if (id) {
        setRowSaved(id, true);
      }
    },
    [setRowSaved],
  );

  return { saveAddedRow, savedRowIds, setRowSaved };
}
