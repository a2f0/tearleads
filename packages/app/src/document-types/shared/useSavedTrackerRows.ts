import { useCallback, useState } from "react";

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
