import type { ContainerDocumentQueries } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";

interface ExplorerDocumentQueriesRuntimeState {
  infra: { readonly dbStatus: string };
  state: { readonly domainScope: object };
}

export function useExplorerDocumentQueries(
  appData: ExplorerDocumentQueriesRuntimeState,
): ContainerDocumentQueries {
  const { containerContents } = useTearleads();

  return useMemo(
    () => containerContents.documentQueries(),
    [appData.infra.dbStatus, appData.state.domainScope, containerContents],
  );
}
