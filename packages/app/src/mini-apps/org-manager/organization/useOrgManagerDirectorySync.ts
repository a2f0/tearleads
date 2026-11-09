import type { Tearleads } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import {
  releaseHeldOrganizationReadModelHint,
  subscribeOrganizationReadModelRealtime,
} from "../../../providers/sdk/organizationReadModelRealtime";
import type {
  DirectoryRefreshOptions,
  DirectoryRefreshResult,
} from "../refresh";
import {
  type DirectoryCatchUpState,
  initialDirectoryCatchUp,
  transitionDirectoryCatchUp,
} from "./directoryCatchUpMachine";

interface OrgManagerDirectorySyncInput {
  readonly canLoadAuthenticatedOrgData: boolean;
  readonly organizationId: string | null;
  readonly mutating: boolean;
  readonly online: boolean;
  readonly refreshDirectoryAndGroups: (
    options?: DirectoryRefreshOptions,
  ) => Promise<DirectoryRefreshResult>;
  readonly scopeKey: string;
  readonly tearleads: Tearleads;
}

/**
 * Immediate local load plus demand-scoped background reconciliation. Returns
 * whether the roster's catch-up is still outstanding: until it settles, an
 * empty local projection means "still syncing", not "never synced".
 */
export function useOrgManagerDirectorySync(
  input: OrgManagerDirectorySyncInput,
): boolean {
  const mutatingRef = useRef(input.mutating);
  const refreshDirectoryAndGroupsRef = useRef(input.refreshDirectoryAndGroups);
  mutatingRef.current = input.mutating;
  refreshDirectoryAndGroupsRef.current = input.refreshDirectoryAndGroups;
  const catchUpKey =
    input.canLoadAuthenticatedOrgData && input.online && input.organizationId
      ? input.scopeKey
      : null;
  const [storedCatchUp, setCatchUp] = useState<DirectoryCatchUpState>(() =>
    initialDirectoryCatchUp(catchUpKey),
  );
  // Apply a changed key during render, so the first frame of a new
  // subscription already reads as awaiting its catch-up.
  const catchUp = transitionDirectoryCatchUp(storedCatchUp, {
    type: "demand",
    key: catchUpKey,
  });
  if (catchUp !== storedCatchUp) {
    setCatchUp(catchUp);
  }

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
      input.tearleads,
      input.organizationId,
      () =>
        refreshDirectoryAndGroupsRef.current({
          clearError: true,
          localOnly: true,
          manageLoading: false,
        }),
      {
        isMutationActive: () => mutatingRef.current,
        onCatchUpSettled: () =>
          setCatchUp((current) =>
            transitionDirectoryCatchUp(current, {
              type: "settle",
              key: input.scopeKey,
            }),
          ),
      },
    );
  }, [
    input.canLoadAuthenticatedOrgData,
    input.online,
    input.organizationId,
    input.scopeKey,
    input.tearleads,
  ]);

  useEffect(() => {
    if (input.mutating || !input.organizationId) {
      return;
    }
    releaseHeldOrganizationReadModelHint(input.tearleads, input.organizationId);
  }, [input.mutating, input.organizationId, input.tearleads]);

  return catchUp.status === "awaiting";
}
