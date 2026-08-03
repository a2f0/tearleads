import { useCallback, useState } from "react";

export type AddTrackerRow<Entry> = (entry: Entry) => Promise<string | null>;

export function useSavedTrackerRows(
  rows: ReadonlyArray<{ readonly id: string }>,
  initialEditingRowId: string | null,
) {
  const [savedRowIds, setSavedRowIds] = useState<ReadonlySet<string>>(() =>
    initialEditingRowId === null
      ? new Set()
      : new Set(
          rows
            .filter((row) => row.id !== initialEditingRowId)
            .map((row) => row.id),
        ),
  );
  const setRowSaved = useCallback((id: string, saved: boolean) => {
    setSavedRowIds((current) => {
      const next = new Set(current);
      if (saved) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
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
