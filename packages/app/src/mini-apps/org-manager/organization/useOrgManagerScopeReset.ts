import { useEffect, useRef } from "react";

interface OrgManagerScopeResetInput {
  readonly closeContextMenu: () => void;
  readonly resetDirectoryState: () => void;
  readonly scopeKey: string;
  readonly setError: (value: null) => void;
  readonly setGrants: (value: null) => void;
  readonly setLoading: (value: false) => void;
  readonly setLoadingUserDetail: (value: false) => void;
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
    input.setError(null);
    // An in-flight managed refresh abandoned by the scope guard skips its own
    // finally-clear, so the reset must release the busy flags itself.
    input.setLoading(false);
    input.setLoadingUserDetail(false);
    input.setMutating(false);
    input.closeContextMenu();
  }, [input]);
}
