import type { SymCrypt } from "@symcrypt/client-sdk";
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
  readonly online: boolean;
  readonly refreshDirectoryAndGroups: (
    options?: DirectoryRefreshOptions,
  ) => Promise<DirectoryRefreshResult>;
  readonly scopeKey: string;
  readonly symcrypt: SymCrypt;
}

/** Immediate local load plus demand-scoped background reconciliation. */
export function useOrgManagerDirectorySync(
  input: OrgManagerDirectorySyncInput,
): void {
  const mutatingRef = useRef(input.mutating);
  const refreshDirectoryAndGroupsRef = useRef(input.refreshDirectoryAndGroups);
  mutatingRef.current = input.mutating;
  refreshDirectoryAndGroupsRef.current = input.refreshDirectoryAndGroups;
  useEffect(() => {
    void refreshDirectoryAndGroupsRef.current({
      localOnly: true,
      manageLoading: false,
    });
  }, [input.scopeKey]);

  useEffect(() => {
    if (
      !input.canLoadAuthenticatedOrgData ||
      !input.online ||
      !input.organizationId
    ) {
      return;
    }
    return subscribeOrganizationReadModelRealtime(
      input.symcrypt,
      input.organizationId,
      () =>
        refreshDirectoryAndGroupsRef.current({
          clearError: true,
          localOnly: true,
          manageLoading: false,
        }),
      {
        isMutationActive: () => mutatingRef.current,
      },
    );
  }, [
    input.canLoadAuthenticatedOrgData,
    input.online,
    input.organizationId,
    input.scopeKey,
    input.symcrypt,
  ]);

  useEffect(() => {
    if (input.mutating || !input.organizationId) {
      return;
    }
    releaseDeferredOrganizationReadModelHint(
      input.symcrypt,
      input.organizationId,
    );
  }, [input.mutating, input.organizationId, input.symcrypt]);
}
