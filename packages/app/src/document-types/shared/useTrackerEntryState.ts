import { useCallback, useState } from "react";

export function usePendingTrackerEntry(onToggleEditing: () => void) {
  const [entryPending, setEntryPending] = useState(false);
  const toggleEditing = useCallback(() => {
    setEntryPending(false);
    onToggleEditing();
  }, [onToggleEditing]);

  return {
    entryPending,
    onPendingChange: setEntryPending,
    toggleEditing,
  };
}

export function useSavedTrackerRows() {
  const [savedRowIds, setSavedRowIds] = useState<ReadonlySet<string>>(
    () => new Set(),
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

  return { savedRowIds, setRowSaved };
}
