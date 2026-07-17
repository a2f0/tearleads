import type { Tearleads } from "@tearleads/client-sdk";
import { useEffect, useRef } from "react";
import {
  releaseDeferredOrganizationReadModelHint,
  subscribeOrganizationReadModelRealtime,
} from "../../../providers/sdk/organizationReadModelRealtime";
import type {
  DirectoryRefreshOptions,
  DirectoryRefreshResult,
} from "../refresh";

interface OrgManagerDirectorySyncInput {
  readonly canLoadAuthenticatedOrgData: boolean;
  readonly organizationId: string | null;
  readonly mutating: boolean;
  readonly readModelCursor: string | null;
  readonly refreshDirectoryAndGroups: (
    options?: DirectoryRefreshOptions,
  ) => Promise<DirectoryRefreshResult>;
  readonly scopeKey: string;
  readonly tearleads: Tearleads;
}

/** Initial authoritative load plus demand-scoped realtime projection updates. */
export function useOrgManagerDirectorySync(
  input: OrgManagerDirectorySyncInput,
): void {
  const mutatingRef = useRef(input.mutating);
  const readModelCursorRef = useRef(input.readModelCursor);
  mutatingRef.current = input.mutating;
  readModelCursorRef.current = input.readModelCursor;
  useEffect(() => {
    void input.refreshDirectoryAndGroups();
  }, [input.refreshDirectoryAndGroups, input.scopeKey]);

  useEffect(() => {
    if (!input.canLoadAuthenticatedOrgData || !input.organizationId) {
      return;
    }
    return subscribeOrganizationReadModelRealtime(
      input.tearleads,
      input.organizationId,
      () =>
        input.refreshDirectoryAndGroups({
          clearError: false,
          localOnly: true,
          manageLoading: false,
        }),
      {
        getReadModelCursor: () => readModelCursorRef.current,
        isMutationActive: () => mutatingRef.current,
      },
    );
  }, [
    input.canLoadAuthenticatedOrgData,
    input.organizationId,
    input.refreshDirectoryAndGroups,
    input.tearleads,
  ]);

  useEffect(() => {
    if (input.mutating || !input.organizationId) {
      return;
    }
    releaseDeferredOrganizationReadModelHint(
      input.tearleads,
      input.organizationId,
      input.readModelCursor,
    );
  }, [
    input.mutating,
    input.organizationId,
    input.readModelCursor,
    input.tearleads,
  ]);
}
