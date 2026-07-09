import type { OrganizationDirectory } from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import type {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import {
  hasRosterProfileDocument,
  loadRosterProfileDisplayName,
} from "../../../stores/org-manager/rosterProfileDisplayNames";

interface OrgManagerProfileDisplayNamesParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  canLoadAuthenticatedOrgData: boolean;
  directory: OrganizationDirectory | null;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  selectedUserIdRef: { current: string | null };
  tearleads: ReturnType<typeof useTearleads>;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Owns roster profile display-name state, derivation, and async loading in one place.
export function useOrgManagerProfileDisplayNames(
  params: OrgManagerProfileDisplayNamesParams,
) {
  const {
    appData,
    canLoadAuthenticatedOrgData,
    directory,
    orgManagerActions,
    selectedUserIdRef,
    tearleads,
  } = params;

  const [profileDisplayNamesByUserId, setProfileDisplayNamesByUserId] =
    useState<ReadonlyMap<string, string>>(new Map());

  const setProfileDisplayName = useCallback(
    (userId: string, displayName: string | null) => {
      const trimmedDisplayName = displayName?.trim() ?? "";

      setProfileDisplayNamesByUserId((current) => {
        const existing = current.get(userId) ?? "";
        if (existing === trimmedDisplayName) {
          return current;
        }

        const next = new Map(current);
        if (trimmedDisplayName.length > 0) {
          next.set(userId, trimmedDisplayName);
        } else {
          next.delete(userId);
        }
        return next;
      });
    },
    [],
  );

  const setSelectedProfileDisplayName = useCallback(
    (displayName: string | null) => {
      if (selectedUserIdRef.current) {
        setProfileDisplayName(selectedUserIdRef.current, displayName);
      }
    },
    [setProfileDisplayName],
  );

  useEffect(() => {
    setProfileDisplayNamesByUserId(new Map());
  }, [appData.auth.organizationId]);

  useEffect(() => {
    const organizationId = appData.auth.organizationId;
    if (!directory || !organizationId || !canLoadAuthenticatedOrgData) {
      return;
    }

    const usersWithProfileDocuments = directory.users.filter(
      hasRosterProfileDocument,
    );
    if (usersWithProfileDocuments.length === 0) {
      return;
    }

    let cancelled = false;
    const unsubscribes: Array<() => void> = [];

    const loadProfileDisplayNames = async () => {
      const profileContainer =
        await orgManagerActions.ensureRosterProfileContainer();
      if (cancelled || !profileContainer?.id) {
        return;
      }

      const runtime = tearleads.documents.workflowRuntime(profileContainer.id);

      await Promise.all(
        usersWithProfileDocuments.map((user) =>
          loadRosterProfileDisplayName({
            documents: tearleads.documents,
            isCancelled: () => cancelled,
            organizationId,
            profileContainerId: profileContainer.id,
            runtime,
            setProfileDisplayName,
            unsubscribes,
            user,
          }),
        ),
      );
    };

    void loadProfileDisplayNames().catch(() => null);

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [
    appData.auth.organizationId,
    canLoadAuthenticatedOrgData,
    directory,
    orgManagerActions,
    setProfileDisplayName,
    tearleads.documents,
  ]);

  return {
    profileDisplayNamesByUserId,
    setProfileDisplayNamesByUserId,
    setSelectedProfileDisplayName,
  };
}
