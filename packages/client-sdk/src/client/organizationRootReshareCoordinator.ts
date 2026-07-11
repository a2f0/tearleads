import type { ContainerContents } from "./containerContents";
import type { PreparedOrganizationRootRewrap } from "./organizationRootReshare";

export interface OrganizationDirectoryForRootReshare {
  adminGroupId: string | null;
}

export type LoadOrganizationDirectoryForRootReshare = (
  organizationId: string,
) => Promise<OrganizationDirectoryForRootReshare | null>;

export type ReshareOrganizationRootToAdmins = (input: {
  adminGroupId: string;
  containerContents: ContainerContents;
  organizationId: string;
}) => Promise<void>;

export type PrepareOrganizationRootRewrapToAdmins = (input: {
  adminGroupId: string;
  containerContents: ContainerContents;
  organizationId: string;
}) => Promise<PreparedOrganizationRootRewrap>;

export interface OrganizationRootReshareCoordinator {
  /**
   * Repair or refresh root access when the changed group is Admins.
   *
   * Failures intentionally reject. Callers use this before replacing the old
   * cached Admins policy, because that policy may be the only remaining way to
   * unwrap root's stale KEK.
   */
  prepareIfAdminsGroup(input: {
    mutatedGroupId: string;
    organizationId: string;
  }): Promise<PreparedOrganizationRootRewrap>;
}

export function createOrganizationRootReshareCoordinator(deps: {
  containerContents: ContainerContents;
  loadDirectory: LoadOrganizationDirectoryForRootReshare;
  prepare: PrepareOrganizationRootRewrapToAdmins;
  reshare: ReshareOrganizationRootToAdmins;
  scheduleRetry?: ((retry: () => Promise<void>) => void) | undefined;
}): OrganizationRootReshareCoordinator {
  const adminGroupIdByOrganization = new Map<string, string>();
  const pendingRewrapByOrganization = new Map<
    string,
    PreparedOrganizationRootRewrap
  >();
  const scheduleRetry =
    deps.scheduleRetry ??
    ((retry: () => Promise<void>) => {
      setTimeout(() => void retry(), 1_000);
    });

  async function applyPendingRewrap(
    organizationId: string,
    prepared: PreparedOrganizationRootRewrap,
  ): Promise<void> {
    await prepared.rewrap();
    if (pendingRewrapByOrganization.get(organizationId) === prepared) {
      pendingRewrapByOrganization.delete(organizationId);
    }
  }

  function retryPendingRewrap(
    organizationId: string,
    prepared: PreparedOrganizationRootRewrap,
  ): void {
    scheduleRetry(async () => {
      try {
        await applyPendingRewrap(organizationId, prepared);
      } catch {}
    });
  }

  async function resolveAdminGroupId(
    organizationId: string,
  ): Promise<string | null> {
    const cached = adminGroupIdByOrganization.get(organizationId);
    if (cached) {
      return cached;
    }

    const directory = await deps.loadDirectory(organizationId);
    const adminGroupId = directory?.adminGroupId ?? null;
    if (!adminGroupId) {
      throw new Error(
        `Admins group could not be resolved for organization ${organizationId}`,
      );
    }
    adminGroupIdByOrganization.set(organizationId, adminGroupId);
    return adminGroupId;
  }

  return {
    async prepareIfAdminsGroup({ mutatedGroupId, organizationId }) {
      const pending = pendingRewrapByOrganization.get(organizationId);
      if (pending) {
        await applyPendingRewrap(organizationId, pending);
      }
      const adminGroupId = await resolveAdminGroupId(organizationId);
      if (mutatedGroupId !== adminGroupId) {
        return { rewrap: async () => undefined };
      }

      await deps.reshare({
        adminGroupId,
        containerContents: deps.containerContents,
        organizationId,
      });
      const prepared = await deps.prepare({
        adminGroupId,
        containerContents: deps.containerContents,
        organizationId,
      });
      pendingRewrapByOrganization.set(organizationId, prepared);
      return {
        async rewrap() {
          try {
            await applyPendingRewrap(organizationId, prepared);
          } catch (error) {
            retryPendingRewrap(organizationId, prepared);
            throw error;
          }
        },
      };
    },
  };
}
