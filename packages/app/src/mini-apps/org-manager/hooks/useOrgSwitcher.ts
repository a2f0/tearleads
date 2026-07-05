import type { LocalOrganizationSummary } from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";

export interface OrgSwitcherState {
  activeOrganizationId: string | null;
  createOrganization: () => Promise<void>;
  creating: boolean;
  organizations: readonly LocalOrganizationSummary[];
  selectOrganization: (organizationId: string) => void;
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
  const [creating, setCreating] = useState(false);

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
  }, [enabled, tearleads, activeOrganizationId]);

  const selectOrganization = useCallback(
    (organizationId: string) => {
      if (organizationId !== activeOrganizationId) {
        tearleads.session.setOrganizationId(organizationId);
      }
    },
    [tearleads, activeOrganizationId],
  );

  const createOrganization = useCallback(async () => {
    setCreating(true);
    try {
      const result = await tearleads.session.createOrganization();
      await reload();
      if (result) {
        tearleads.session.setOrganizationId(result.organizationId);
      }
    } finally {
      setCreating(false);
    }
  }, [reload, tearleads]);

  return useMemo(
    () => ({
      activeOrganizationId,
      createOrganization,
      creating,
      organizations,
      selectOrganization,
    }),
    [
      activeOrganizationId,
      createOrganization,
      creating,
      organizations,
      selectOrganization,
    ],
  );
}
