import type { ContainerNode, Tearleads } from "@tearleads/client-sdk";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { usePrimaryLocalOrganization } from "../../../providers/sdk/usePrimaryLocalOrganization";
import { resolveExplorerPrimaryOrganizationId } from "../primaryOrganization";

export function useExplorerPrimaryOrganizationId(input: {
  readonly appData: RuntimeSnapshot;
  readonly nodes: ReadonlyArray<ContainerNode>;
  readonly ready: boolean;
  readonly tearleads: Tearleads;
}): string | null {
  const primaryLocalOrganization = usePrimaryLocalOrganization({
    // Explorer snapshots can transiently become unready during reconciliation.
    // Keep the personal-org lookup alive while SQLite remains available so an
    // active custom org cannot briefly replace the self-contact projection.
    enabled:
      input.appData.auth.isAuthenticated &&
      input.appData.infra.dbStatus === "ready",
    refreshKey: [
      input.appData.auth.organizationId ?? "",
      input.appData.state.containerId ?? "",
      String(input.nodes.length),
    ].join(":"),
    tearleads: input.tearleads,
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
