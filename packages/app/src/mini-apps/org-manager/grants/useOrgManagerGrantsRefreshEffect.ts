import { useEffect, useRef } from "react";

interface OrgManagerGrantsRefreshInput {
  readonly enabled: boolean;
  readonly readModelCursor: string | null;
  readonly refreshGrants: () => Promise<void>;
  readonly scopeKey: string;
  readonly visible: boolean;
}

export function useOrgManagerGrantsRefreshEffect(
  input: OrgManagerGrantsRefreshInput,
): void {
  const grantsVisible = input.enabled && input.visible;
  const wasGrantsVisibleRef = useRef(false);
  const previousReadModelCursorRef = useRef(input.readModelCursor);
  const previousScopeKeyRef = useRef(input.scopeKey);

  useEffect(() => {
    const wasGrantsVisible = wasGrantsVisibleRef.current;
    const previousReadModelCursor = previousReadModelCursorRef.current;
    const previousScopeKey = previousScopeKeyRef.current;
    wasGrantsVisibleRef.current = grantsVisible;
    previousReadModelCursorRef.current = input.readModelCursor;
    previousScopeKeyRef.current = input.scopeKey;

    if (!grantsVisible) {
      return;
    }
    // Continuous read-model demand owns remote reconciliation. View entry, a
    // cursor change, and an organization switch (which clears the projection)
    // each repaint grants from the local projection. Without the scope check a
    // switch between two organizations that both have a null cursor would leave
    // grants stuck pending until a manual refresh.
    if (
      !wasGrantsVisible ||
      previousReadModelCursor !== input.readModelCursor ||
      previousScopeKey !== input.scopeKey
    ) {
      void input.refreshGrants();
    }
  }, [
    grantsVisible,
    input.readModelCursor,
    input.refreshGrants,
    input.scopeKey,
  ]);
}
