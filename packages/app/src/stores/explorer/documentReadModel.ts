import type { ContainerDocumentReadModel } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";

interface ExplorerDocumentReadModelRuntimeState {
  infra: { readonly dbStatus: string };
  state: { readonly domainScope: object };
}

export function useExplorerDocumentReadModel(
  appData: ExplorerDocumentReadModelRuntimeState,
): ContainerDocumentReadModel {
  const { containerContents } = useTearleads();

  return useMemo(
    () => containerContents.documentReadModel(),
    [appData.infra.dbStatus, appData.state.domainScope, containerContents],
  );
}
