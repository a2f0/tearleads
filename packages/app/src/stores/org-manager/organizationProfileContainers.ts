import type {
  ContainerContentsStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
  ORGANIZATION_METADATA_CONTAINER_NAME,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useCallback, useMemo } from "react";
import type { OrgManagerOperationScope } from "./orgManagerOperationScope";
import {
  ensureOrganizationSystemContainer,
  findOrganizationSystemContainer,
} from "./rosterProfile";

interface OrganizationProfileContainersInput {
  readonly captureOperationScope: () => OrgManagerOperationScope | null;
  readonly containerContentsStore: ContainerContentsStore;
  readonly isOperationScopeActive: (scope: OrgManagerOperationScope) => boolean;
}

/**
 * The two system containers the org-manager profile editors write into.
 *
 * They are deliberately distinct: the roster-profile container holds per-user
 * profiles and stays Admins-scoped, while the organization-metadata container
 * is an independent root holding encrypted metadata and is granted read
 * to the reserved Members group. Provisioning creates the organization_profile
 * document in the metadata container and local name resolution looks for it
 * there, so binding that document anywhere else hides the organization name
 * from members and from a device that re-hydrates an identity.
 */
export function useOrganizationProfileContainers(
  input: OrganizationProfileContainersInput,
): {
  ensureOrganizationMetadataContainer: () => Promise<ContainerNode | null>;
  ensureRosterProfileContainer: () => Promise<ContainerNode | null>;
  findRosterProfileContainer: () => Promise<ContainerNode | null>;
  subscribeToContainers: (listener: () => void) => () => void;
} {
  const {
    captureOperationScope,
    containerContentsStore,
    isOperationScopeActive,
  } = input;
  const ensureSystemContainer = useCallback(
    async (
      deriveSystemSlot: (input: {
        readonly organizationId: string;
      }) => Promise<ContainerSystemSlot>,
      name: string,
      independentRoot: boolean,
    ) => {
      const operationScope = captureOperationScope();
      if (!operationScope || !isOperationScopeActive(operationScope)) {
        return null;
      }

      const systemSlot = await deriveSystemSlot({
        organizationId: operationScope.organizationId,
      });
      if (!isOperationScopeActive(operationScope)) {
        return null;
      }
      const container = await ensureOrganizationSystemContainer({
        containerStore: containerContentsStore,
        independentRoot,
        name,
        organizationId: operationScope.organizationId,
        systemSlot,
      });
      return isOperationScopeActive(operationScope) ? container : null;
    },
    [captureOperationScope, containerContentsStore, isOperationScopeActive],
  );

  const ensureRosterProfileContainer = useCallback(
    () =>
      ensureSystemContainer(
        deriveOrganizationRosterProfileContainerSystemSlot,
        ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
        false,
      ),
    [ensureSystemContainer],
  );
  // Reads never provision: a device that has not listed the container yet
  // gets null rather than a duplicate.
  const findRosterProfileContainer = useCallback(async () => {
    const operationScope = captureOperationScope();
    if (!operationScope || !isOperationScopeActive(operationScope)) {
      return null;
    }
    const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot(
      { organizationId: operationScope.organizationId },
    );
    if (!isOperationScopeActive(operationScope)) {
      return null;
    }
    return findOrganizationSystemContainer({
      containerStore: containerContentsStore,
      independentRoot: false,
      organizationId: operationScope.organizationId,
      systemSlot,
    });
  }, [captureOperationScope, containerContentsStore, isOperationScopeActive]);
  const ensureOrganizationMetadataContainer = useCallback(
    () =>
      ensureSystemContainer(
        deriveOrganizationMetadataContainerSystemSlot,
        ORGANIZATION_METADATA_CONTAINER_NAME,
        true,
      ),
    [ensureSystemContainer],
  );

  const subscribeToContainers = useCallback(
    (listener: () => void) => containerContentsStore.subscribe(listener),
    [containerContentsStore],
  );

  return useMemo(
    () => ({
      ensureOrganizationMetadataContainer,
      ensureRosterProfileContainer,
      findRosterProfileContainer,
      subscribeToContainers,
    }),
    [
      ensureOrganizationMetadataContainer,
      ensureRosterProfileContainer,
      findRosterProfileContainer,
      subscribeToContainers,
    ],
  );
}
