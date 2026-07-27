import type { ContainerNode } from "@tearleads/client-sdk";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { usePrimaryLocalOrganization } from "../../../providers/sdk/usePrimaryLocalOrganization";
import { resolveExplorerPrimaryOrganizationId } from "../primaryOrganization";

export function useExplorerPrimaryOrganizationId(input: {
  readonly appData: RuntimeSnapshot;
  readonly nodes: ReadonlyArray<ContainerNode>;
}): string | null {
  const primaryLocalOrganization = usePrimaryLocalOrganization({
    defaultOrganizationId: input.appData.auth.defaultOrganizationId,
    enabled:
      input.appData.auth.isAuthenticated &&
      input.appData.infra.dbStatus === "ready",
  });
  return resolveExplorerPrimaryOrganizationId({
    currentOrganizationId: input.appData.auth.organizationId,
    nodes: input.nodes,
    personalRootContainerId: input.appData.state.containerId,
    primaryLocalOrganizationId: primaryLocalOrganization.ready
      ? primaryLocalOrganization.organizationId
      : null,
  });
}
