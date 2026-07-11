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

interface ActiveOrganizationRootRewrap {
  prepared: PreparedOrganizationRootRewrap;
  promise: Promise<void>;
}

async function applyOrganizationRootRewrap(input: {
  activeByOrganization: Map<string, ActiveOrganizationRootRewrap>;
  organizationId: string;
  pendingByOrganization: Map<string, PreparedOrganizationRootRewrap>;
  prepared: PreparedOrganizationRootRewrap;
}): Promise<void> {
  if (
    input.pendingByOrganization.get(input.organizationId) !== input.prepared
  ) {
    return;
  }

  const active = input.activeByOrganization.get(input.organizationId);
  if (active) {
    await active.promise;
    if (active.prepared === input.prepared) {
      return;
    }
    return applyOrganizationRootRewrap(input);
  }

  const promise = (async () => {
    await input.prepared.rewrap();
    if (
      input.pendingByOrganization.get(input.organizationId) === input.prepared
    ) {
      input.pendingByOrganization.delete(input.organizationId);
    }
  })();
  input.activeByOrganization.set(input.organizationId, {
    prepared: input.prepared,
    promise,
  });
  try {
    await promise;
  } finally {
    const current = input.activeByOrganization.get(input.organizationId);
    if (current?.promise === promise) {
      input.activeByOrganization.delete(input.organizationId);
    }
  }
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
  const activeRewrapByOrganization = new Map<
    string,
    ActiveOrganizationRootRewrap
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
    return applyOrganizationRootRewrap({
      activeByOrganization: activeRewrapByOrganization,
      organizationId,
      pendingByOrganization: pendingRewrapByOrganization,
      prepared,
    });
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
