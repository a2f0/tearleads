import {
  deriveOrganizationRosterProfileContainerSystemSlot,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  hasRosterProfileDocument,
  loadRosterProfileDisplayName,
} from "../../../stores/org-manager/rosterProfileDisplayNames";
import { getExplorerAttributionUserLabel } from "../detail/attributionDisplay";
import type { ExplorerModelExplorer } from "./explorerModelTypes";

type TearleadsRuntime = ReturnType<typeof useTearleads>;

function setProfileDisplayNameInMap(input: {
  displayName: string | null;
  setProfileDisplayNamesByUserId: (
    value: (
      current: ReadonlyMap<string, string>,
    ) => ReadonlyMap<string, string>,
  ) => void;
  userId: string;
}) {
  const trimmedDisplayName = input.displayName?.trim() ?? "";
  input.setProfileDisplayNamesByUserId((current) => {
    const existing = current.get(input.userId) ?? "";
    if (existing === trimmedDisplayName) {
      return current;
    }

    const next = new Map(current);
    if (trimmedDisplayName.length > 0) {
      next.set(input.userId, trimmedDisplayName);
    } else {
      next.delete(input.userId);
    }
    return next;
  });
}

async function loadExplorerAttributionProfileDisplayNames(input: {
  ensureSystemContainer: ExplorerModelExplorer["ensureSystemContainer"];
  isCancelled: () => boolean;
  organizationId: string;
  setProfileDisplayName: (userId: string, displayName: string | null) => void;
  tearleads: TearleadsRuntime;
  unsubscribes: Array<() => void>;
}) {
  const directoryAndGroups =
    await input.tearleads.organizations.loadDirectoryAndGroups();
  const directory = directoryAndGroups?.directory ?? null;
  if (input.isCancelled() || !directory?.currentUser.isOrgAdmin) {
    return;
  }

  const usersWithProfileDocuments = directory.users.filter(
    hasRosterProfileDocument,
  );
  if (usersWithProfileDocuments.length === 0) {
    return;
  }

  const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot({
    organizationId: input.organizationId,
  });
  if (input.isCancelled()) {
    return;
  }

  const profileContainer = await input.ensureSystemContainer(
    systemSlot,
    ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
  );
  if (input.isCancelled() || !profileContainer?.id) {
    return;
  }

  const runtime = input.tearleads.documents.workflowRuntime(
    profileContainer.id,
  );
  await Promise.all(
    usersWithProfileDocuments.map((user) =>
      loadRosterProfileDisplayName({
        documents: input.tearleads.documents,
        isCancelled: input.isCancelled,
        organizationId: input.organizationId,
        profileContainerId: profileContainer.id,
        runtime,
        setProfileDisplayName: input.setProfileDisplayName,
        unsubscribes: input.unsubscribes,
        user,
      }),
    ),
  );
}

export function useExplorerAttributionUserLabels(input: {
  appData: RuntimeSnapshot;
  enabled: boolean;
  explorer: Pick<ExplorerModelExplorer, "ensureSystemContainer">;
}) {
  const { appData, enabled, explorer } = input;
  const tearleads = useTearleads();
  const [profileDisplayNamesByUserId, setProfileDisplayNamesByUserId] =
    useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    setProfileDisplayNamesByUserId((current) =>
      current.size > 0 ? new Map() : current,
    );
  }, [appData.auth.organizationId, appData.auth.userId]);

  useEffect(() => {
    const organizationId = appData.auth.organizationId;
    if (
      !enabled ||
      !organizationId ||
      !appData.auth.isAuthenticated ||
      appData.infra.dbStatus !== "ready"
    ) {
      return;
    }

    let cancelled = false;
    const unsubscribes: Array<() => void> = [];
    const setProfileDisplayName = (
      userId: string,
      displayName: string | null,
    ) => {
      if (cancelled) {
        return;
      }
      setProfileDisplayNameInMap({
        displayName,
        setProfileDisplayNamesByUserId,
        userId,
      });
    };

    void loadExplorerAttributionProfileDisplayNames({
      ensureSystemContainer: explorer.ensureSystemContainer,
      isCancelled: () => cancelled,
      organizationId,
      setProfileDisplayName,
      tearleads,
      unsubscribes,
    }).catch((error: unknown) => {
      if (!cancelled) {
        tearleads.logError(
          "Failed to load explorer attribution roster display names",
          error,
        );
      }
    });

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [
    appData.auth.isAuthenticated,
    appData.auth.organizationId,
    appData.infra.dbStatus,
    enabled,
    explorer.ensureSystemContainer,
    tearleads.documents,
    tearleads.logError,
    tearleads.organizations,
  ]);

  return useCallback(
    (userId: string | null | undefined) =>
      getExplorerAttributionUserLabel({
        currentUserId: appData.auth.userId,
        profileDisplayNamesByUserId,
        userId,
      }),
    [appData.auth.userId, profileDisplayNamesByUserId],
  );
}
