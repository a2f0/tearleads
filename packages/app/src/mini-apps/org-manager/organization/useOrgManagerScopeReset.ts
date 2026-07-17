import { useEffect, useRef } from "react";

interface OrgManagerScopeResetInput {
  readonly closeContextMenu: () => void;
  readonly resetDirectoryState: () => void;
  readonly scopeKey: string;
  readonly setDataUsage: (value: null) => void;
  readonly setError: (value: null) => void;
  readonly setGrants: (value: null) => void;
  readonly setMutating: (value: false) => void;
  readonly setOrganizationPolicyHistory: (value: null) => void;
}

/** Clears view state only when the selected organization scope changes. */
export function useOrgManagerScopeReset(
  input: OrgManagerScopeResetInput,
): void {
  const previousScopeKeyRef = useRef(input.scopeKey);
  useEffect(() => {
    if (previousScopeKeyRef.current === input.scopeKey) {
      return;
    }
    previousScopeKeyRef.current = input.scopeKey;
    input.resetDirectoryState();
    input.setOrganizationPolicyHistory(null);
    input.setGrants(null);
    input.setDataUsage(null);
    input.setError(null);
    input.setMutating(false);
    input.closeContextMenu();
  }, [input]);
}
