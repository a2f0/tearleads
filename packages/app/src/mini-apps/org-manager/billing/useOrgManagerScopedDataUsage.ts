import type { OrganizationDataUsage } from "@symcrypt/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface DataUsageScope {
  readonly valueRef: { current: OrganizationDataUsage | null };
}

interface ScopedDataUsage {
  readonly scope: DataUsageScope;
  readonly value: OrganizationDataUsage | null;
}

/** Keeps requester-specific usage hidden whenever the persistence scope changes. */
export function useOrgManagerScopedDataUsage(scopeKey: string): {
  readonly dataUsage: OrganizationDataUsage | null;
  readonly dataUsageRef: { current: OrganizationDataUsage | null };
  readonly setDataUsage: Dispatch<SetStateAction<OrganizationDataUsage | null>>;
} {
  const scope = useMemo<DataUsageScope>(
    () => ({ valueRef: { current: null } }),
    [scopeKey],
  );
  const activeScopeRef = useRef(scope);
  useLayoutEffect(() => {
    activeScopeRef.current = scope;
  }, [scope]);
  const [scopedDataUsage, setScopedDataUsage] = useState<ScopedDataUsage>({
    scope,
    value: null,
  });
  const dataUsage =
    scopedDataUsage.scope === scope ? scopedDataUsage.value : null;
  const setDataUsage = useCallback<
    Dispatch<SetStateAction<OrganizationDataUsage | null>>
  >(
    (update) => {
      if (activeScopeRef.current !== scope) {
        return;
      }
      const value =
        typeof update === "function" ? update(scope.valueRef.current) : update;
      scope.valueRef.current = value;
      setScopedDataUsage((current) => {
        if (activeScopeRef.current !== scope) {
          return current;
        }
        if (current.scope === scope && Object.is(current.value, value)) {
          return current;
        }
        return { scope, value };
      });
    },
    [scope],
  );

  return { dataUsage, dataUsageRef: scope.valueRef, setDataUsage };
}
