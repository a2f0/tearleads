import type { OrganizationDataUsage } from "@tearleads/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";

interface ScopedDataUsage {
  readonly scopeKey: string;
  readonly value: OrganizationDataUsage | null;
}

/** Keeps requester-specific usage hidden whenever the full runtime scope changes. */
export function useOrgManagerScopedDataUsage(scopeKey: string): {
  readonly dataUsage: OrganizationDataUsage | null;
  readonly dataUsageRef: { current: OrganizationDataUsage | null };
  readonly setDataUsage: Dispatch<SetStateAction<OrganizationDataUsage | null>>;
} {
  const [scopedDataUsage, setScopedDataUsage] = useState<ScopedDataUsage>({
    scopeKey,
    value: null,
  });
  const dataUsage =
    scopedDataUsage.scopeKey === scopeKey ? scopedDataUsage.value : null;
  const dataUsageRef = useRef<OrganizationDataUsage | null>(dataUsage);
  dataUsageRef.current = dataUsage;
  const setDataUsage = useCallback<
    Dispatch<SetStateAction<OrganizationDataUsage | null>>
  >(
    (update) => {
      setScopedDataUsage((current) => {
        const currentValue =
          current.scopeKey === scopeKey ? current.value : null;
        const value =
          typeof update === "function" ? update(currentValue) : update;
        if (current.scopeKey === scopeKey && Object.is(current.value, value)) {
          return current;
        }
        return { scopeKey, value };
      });
    },
    [scopeKey],
  );

  return { dataUsage, dataUsageRef, setDataUsage };
}
