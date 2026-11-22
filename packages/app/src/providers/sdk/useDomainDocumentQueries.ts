import type { ContainerDocumentQueries } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleads } from "./TearleadsProvider";

interface DomainDocumentQueriesRuntimeState {
  infra: { readonly dbStatus: string };
  state: { readonly domainScope: object };
}

/**
 * The document query handle for the runtime's current database and domain
 * scope, shared by the Explorer, the Sync Status tray app, and the System
 * Monitor report.
 */
export function useDomainDocumentQueries(
  appData: DomainDocumentQueriesRuntimeState,
): ContainerDocumentQueries {
  const { containerContents } = useTearleads();

  return useMemo(
    () => containerContents.documentQueries(),
    // Deliberately narrower than useRuntimeScopedMemo: rebuilding this handle's
    // watcher performs an immediate orphan-visibility scan outside the throttle,
    // so unrelated runtime notifications must not rotate it.
    [appData.infra.dbStatus, appData.state.domainScope, containerContents],
  );
}
