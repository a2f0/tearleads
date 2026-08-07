import { useEffect, useRef } from "react";

type PendingChange = (pending: boolean) => void;

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
