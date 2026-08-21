import type { ContainerDocumentQueries } from "@symcrypt/client-sdk";
import { useMemo } from "react";
import { useSymCrypt } from "../../providers/sdk/SymCryptProvider";

interface ExplorerDocumentQueriesRuntimeState {
  infra: { readonly dbStatus: string };
  state: { readonly domainScope: object };
}

export function useExplorerDocumentQueries(
  appData: ExplorerDocumentQueriesRuntimeState,
): ContainerDocumentQueries {
  const { containerContents } = useSymCrypt();

  return useMemo(
    () => containerContents.documentQueries(),
    // Deliberately narrower than useRuntimeScopedMemo: rebuilding this handle's
    // watcher performs an immediate orphan-visibility scan outside the throttle,
    // so unrelated runtime notifications must not rotate it.
    [appData.infra.dbStatus, appData.state.domainScope, containerContents],
  );
}
