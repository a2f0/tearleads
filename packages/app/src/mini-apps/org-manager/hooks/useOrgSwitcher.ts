import type {
  LocalOrganizationSummary,
  SessionContext,
  SessionCreateOrganizationResult,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";

export interface OrgSwitcherState {
  activeOrganizationId: string | null;
  closeCreateOrganizationDialog: () => void;
  createOrganization: (organizationName: string) => Promise<void>;
  createOrganizationError: string | null;
  creating: boolean;
  isCreateOrganizationDialogOpen: boolean;
  openCreateOrganizationDialog: () => void;
  organizations: readonly LocalOrganizationSummary[];
  selectOrganization: (organizationId: string) => void;
}

interface CreateOrganizationDialogState {
  closeCreateOrganizationDialog: () => void;
  createOrganization: (organizationName: string) => Promise<void>;
  createOrganizationError: string | null;
  creating: boolean;
  isCreateOrganizationDialogOpen: boolean;
  openCreateOrganizationDialog: () => void;
}

export function resolveOrgSwitcherSessionContext(
  organizations: readonly LocalOrganizationSummary[],
  organizationId: string,
): SessionContext | null {
  const organization = organizations.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  if (!organization) {
    return null;
  }

  return {
    containerId: organization.rootContainerId,
    organizationId,
  };
}

function useCreateOrganizationDialog({
  provisionOrganization,
  reload,
  selectCreatedOrganization,
}: {
  provisionOrganization: (
    organizationProfileName: string,
  ) => Promise<SessionCreateOrganizationResult | null>;
  reload: () => Promise<void>;
  selectCreatedOrganization: (result: SessionCreateOrganizationResult) => void;
}): CreateOrganizationDialogState {
  const [creating, setCreating] = useState(false);
  const [isCreateOrganizationDialogOpen, setIsCreateOrganizationDialogOpen] =
    useState(false);
  const [createOrganizationError, setCreateOrganizationError] = useState<
    string | null
  >(null);

  const openCreateOrganizationDialog = useCallback(() => {
    setCreateOrganizationError(null);
    setIsCreateOrganizationDialogOpen(true);
  }, []);

  const closeCreateOrganizationDialog = useCallback(() => {
    if (creating) {
      return;
    }

    setCreateOrganizationError(null);
    setIsCreateOrganizationDialogOpen(false);
  }, [creating]);

  const createOrganization = useCallback(
    async (organizationName: string) => {
      const organizationProfileName = organizationName.trim();
      if (organizationProfileName.length === 0) {
        return;
      }

      setCreating(true);
      setCreateOrganizationError(null);
      try {
        const result = await provisionOrganization(organizationProfileName);
        await reload();
        if (result) {
          selectCreatedOrganization(result);
        }
        setIsCreateOrganizationDialogOpen(false);
      } catch (error) {
        console.error("Failed to create organization:", error);
        setCreateOrganizationError(ORG_MANAGER_LABELS.failedCreateOrganization);
      } finally {
        setCreating(false);
      }
    },
    [provisionOrganization, reload, selectCreatedOrganization],
  );

  return useMemo(
    () => ({
      closeCreateOrganizationDialog,
      createOrganization,
      createOrganizationError,
      creating,
      isCreateOrganizationDialogOpen,
      openCreateOrganizationDialog,
    }),
    [
      closeCreateOrganizationDialog,
      createOrganization,
      createOrganizationError,
      creating,
      isCreateOrganizationDialogOpen,
      openCreateOrganizationDialog,
    ],
  );
}

/**
 * Backs the org-manager organization switcher: enumerates the organizations the
 * user can manage locally and lets them pick which one is active or provision a
 * new one. Selecting an organization updates the single active organization
 * (org-manager scopes everything to it); the Explorer resolves files across
 * organizations independently, so nothing else needs to switch.
 */
export function useOrgSwitcher({
  activeOrganizationId,
  enabled,
}: {
  activeOrganizationId: string | null;
  enabled: boolean;
}): OrgSwitcherState {
  const tearleads = useTearleads();
  const [organizations, setOrganizations] = useState<
    readonly LocalOrganizationSummary[]
  >([]);

  const reload = useCallback(async () => {
    setOrganizations(await tearleads.organizations.listLocalOrganizations());
  }, [tearleads]);

  useEffect(() => {
    if (!enabled) {
      setOrganizations([]);
      return;
    }

    let cancelled = false;
    void tearleads.organizations
      .listLocalOrganizations()
      .then((list) => {
        if (!cancelled) {
          setOrganizations(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOrganizations([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, tearleads]);

  const selectOrganization = useCallback(
    (organizationId: string) => {
      if (organizationId !== activeOrganizationId) {
        const context = resolveOrgSwitcherSessionContext(
          organizations,
          organizationId,
        );
        if (context) {
          tearleads.session.setContext(context);
        }
      }
    },
    [tearleads, activeOrganizationId, organizations],
  );

  const provisionOrganization = useCallback(
    (organizationProfileName: string) =>
      tearleads.session.createOrganization({ organizationProfileName }),
    [tearleads],
  );
  const selectCreatedOrganization = useCallback(
    (result: SessionCreateOrganizationResult) => {
      tearleads.session.setContext({
        containerId: result.containerId,
        organizationId: result.organizationId,
      });
    },
    [tearleads],
  );
  const createOrganizationDialog = useCreateOrganizationDialog({
    provisionOrganization,
    reload,
    selectCreatedOrganization,
  });

  return useMemo(
    () => ({
      activeOrganizationId,
      ...createOrganizationDialog,
      organizations,
      selectOrganization,
    }),
    [
      activeOrganizationId,
      createOrganizationDialog,
      organizations,
      selectOrganization,
    ],
  );
}
