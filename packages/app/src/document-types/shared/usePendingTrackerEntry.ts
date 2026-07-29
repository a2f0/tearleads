import { useEffect, useRef, useState } from "react";

type PendingChange = (pending: boolean) => void;

export function usePendingTrackerEntry(onToggleEditing: () => void) {
  const [entryPending, setEntryPending] = useState(false);

  return {
    entryPending,
    onPendingChange: setEntryPending,
    toggleEditing: onToggleEditing,
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
