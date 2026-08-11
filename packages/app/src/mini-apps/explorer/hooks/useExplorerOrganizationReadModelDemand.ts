import type {
  DomainScope,
  OrganizationDirectoryAndGroups,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useState } from "react";
import { subscribeOrganizationReadModelRealtime } from "../../../providers/sdk/organizationReadModelRealtime";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";

export interface ExplorerOrganizationReadModelScope {
  readonly domainScope: DomainScope;
  readonly organizationId: string;
  readonly userId: string;
}

function isSameScope(
  left: ExplorerOrganizationReadModelScope | null,
  right: ExplorerOrganizationReadModelScope | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.domainScope === right.domainScope &&
    left.organizationId === right.organizationId &&
    left.userId === right.userId
  );
}

export function useExplorerOrganizationReadModelDemand(input: {
  readonly appData: Pick<RuntimeSnapshot, "auth" | "infra" | "state">;
  readonly enabled: boolean;
}): {
  readonly projection: OrganizationDirectoryAndGroups | null;
  readonly revision: number;
  readonly scope: ExplorerOrganizationReadModelScope | null;
} {
  const tearleads = useTearleads();
  const organizationId = input.appData.auth.organizationId;
  const userId = input.appData.auth.userId;
  const domainScope = input.appData.state.domainScope;
  const activeScope = useMemo(
    () =>
      input.appData.auth.isAuthenticated &&
      input.appData.infra.dbStatus === "ready" &&
      typeof organizationId === "string" &&
      typeof userId === "string"
        ? { domainScope, organizationId, userId }
        : null,
    [
      domainScope,
      input.appData.auth.isAuthenticated,
      input.appData.infra.dbStatus,
      organizationId,
      userId,
    ],
  );
  const [demandedScope, setDemandedScope] =
    useState<ExplorerOrganizationReadModelScope | null>(null);
  const [projectionState, setProjectionState] = useState<{
    readonly projection: OrganizationDirectoryAndGroups | null;
    readonly revision: number;
    readonly scope: ExplorerOrganizationReadModelScope;
  } | null>(null);
  const demanded = isSameScope(demandedScope, activeScope);
  const canDemandProjection =
    input.appData.state.online && activeScope !== null;

  useEffect(() => {
    if (!activeScope) {
      setDemandedScope(null);
    } else if (input.enabled) {
      setDemandedScope(activeScope);
    }
  }, [activeScope, input.enabled]);

  useEffect(() => {
    if (!demanded || !canDemandProjection || !organizationId || !activeScope) {
      return;
    }
    return subscribeOrganizationReadModelRealtime(
      tearleads,
      organizationId,
      async () => {
        const projection =
          await tearleads.organizations.loadLocalDirectoryAndGroups();
        setProjectionState((current) => ({
          projection,
          revision:
            current && isSameScope(current.scope, activeScope)
              ? current.revision + 1
              : 1,
          scope: activeScope,
        }));
      },
    );
  }, [canDemandProjection, demanded, activeScope, organizationId, tearleads]);

  if (!projectionState || !isSameScope(projectionState.scope, activeScope)) {
    return { projection: null, revision: 0, scope: activeScope };
  }
  return {
    projection: projectionState.projection,
    revision: projectionState.revision,
    scope: activeScope,
  };
}
