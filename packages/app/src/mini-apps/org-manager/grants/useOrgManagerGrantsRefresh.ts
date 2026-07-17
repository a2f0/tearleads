import { useEffect, useRef } from "react";

interface OrgManagerGrantsRefreshInput {
  readonly enabled: boolean;
  readonly readModelCursor: string | null;
  readonly refreshGrants: () => Promise<void>;
  readonly refreshGrantsOnEntry: () => Promise<void>;
  readonly visible: boolean;
}

export function useOrgManagerGrantsRefresh(
  input: OrgManagerGrantsRefreshInput,
): void {
  const grantsVisible = input.enabled && input.visible;
  const wasGrantsVisibleRef = useRef(false);
  const previousReadModelCursorRef = useRef(input.readModelCursor);

  useEffect(() => {
    const wasGrantsVisible = wasGrantsVisibleRef.current;
    const previousReadModelCursor = previousReadModelCursorRef.current;
    wasGrantsVisibleRef.current = grantsVisible;
    previousReadModelCursorRef.current = input.readModelCursor;

    if (!grantsVisible) {
      return;
    }
    if (!wasGrantsVisible) {
      void input.refreshGrantsOnEntry();
      return;
    }
    if (previousReadModelCursor !== input.readModelCursor) {
      void input.refreshGrants();
    }
  }, [
    grantsVisible,
    input.readModelCursor,
    input.refreshGrants,
    input.refreshGrantsOnEntry,
  ]);
}
