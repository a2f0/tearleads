import { useCallback, useEffect, useRef, useState } from "react";

type PendingChange = (pending: boolean) => void;

export function usePendingTrackerEntry(onToggleEditing: () => void) {
  const [entryPending, setEntryPending] = useState(false);
  const toggleEditing = useCallback(() => {
    // The toolbar is disabled while an entry is pending. Keep this reset as a
    // defensive guard for alternate hosts that may invoke the action directly.
    setEntryPending(false);
    onToggleEditing();
  }, [onToggleEditing]);

  return {
    entryPending,
    onPendingChange: setEntryPending,
    toggleEditing,
  };
}

export function useClearPendingOnUnmount(onPendingChange: PendingChange) {
  const onPendingChangeRef = useRef(onPendingChange);
  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);

  useEffect(
    () => () => {
      onPendingChangeRef.current(false);
    },
    [],
  );
}
