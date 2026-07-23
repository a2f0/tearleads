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
 * holds org-wide public metadata (the display name today) and is granted read
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
      const existingContainer = containerContentsStore
        .getSnapshot()
        .nodes.find((node) => node.systemSlot === systemSlot);

      return (
        existingContainer ??
        containerContentsStore.ensureSystemContainer(systemSlot, name)
      );
    },
    [captureOperationScope, containerContentsStore, isOperationScopeActive],
  );

  const ensureRosterProfileContainer = useCallback(
    () =>
      ensureSystemContainer(
        deriveOrganizationRosterProfileContainerSystemSlot,
        ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
      ),
    [ensureSystemContainer],
  );
  const ensureOrganizationMetadataContainer = useCallback(
    () =>
      ensureSystemContainer(
        deriveOrganizationMetadataContainerSystemSlot,
        ORGANIZATION_METADATA_CONTAINER_NAME,
      ),
    [ensureSystemContainer],
  );

  return useMemo(
    () => ({
      ensureOrganizationMetadataContainer,
      ensureRosterProfileContainer,
    }),
    [ensureOrganizationMetadataContainer, ensureRosterProfileContainer],
  );
}
