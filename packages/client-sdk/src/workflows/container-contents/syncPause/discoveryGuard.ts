import {
  containerContentsSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { upsertDiscoveredDocuments } from "../../../data/persistence/documents/documentsPersistence";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { DiscoverContainerDocumentsOptions } from "../documentDiscovery/documentDiscoveryTypes";

type PauseGuardedDiscovery = Pick<
  DiscoverContainerDocumentsOptions,
  | "replaceDocumentLinksBatch"
  | "saveContainerDocumentWatermark"
  | "upsertDiscoveredDocuments"
  | "verifyDiscoveredDocuments"
>;

/**
 * Binds a discovery lane's writes to its container's organization staying
 * unpaused. A listing still in flight when the organization is paused stops
 * being current, so the apply stops at its next check, and each write it has
 * already started re-checks under the SQLite mutation lock the pause cleanup
 * holds. A stale listing therefore never restores documents, links, or the
 * watermark the cleanup removed; a watermark saved after the cleanup would
 * otherwise make the listing after a resume skip every unchanged document.
 */
export function guardDiscoveryAgainstPause(input: {
  readonly execSql: ExecSql;
  readonly isPaused: () => boolean;
  readonly verifyDiscoveredDocuments: DiscoverContainerDocumentsOptions["verifyDiscoveredDocuments"];
}): PauseGuardedDiscovery {
  const unlessPaused = <T>(
    skipped: T,
    write: (lockedExecSql: ExecSql) => Promise<T>,
  ): Promise<T> =>
    runSerializedSqlMutation(input.execSql, async (lockedExecSql) =>
      input.isPaused() ? skipped : write(lockedExecSql),
    );
  return {
    replaceDocumentLinksBatch: (inputs) =>
      unlessPaused(undefined, (lockedExecSql) =>
        sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
          lockedExecSql,
          inputs,
        ),
      ),
    saveContainerDocumentWatermark: (containerId, watermark) =>
      unlessPaused(undefined, async (lockedExecSql) => {
        await sqlContainerSyncWatermarkPersistence.saveWatermark(
          lockedExecSql,
          containerContentsSyncLane(containerId),
          watermark,
        );
      }),
    upsertDiscoveredDocuments: (inputs) =>
      unlessPaused([], (lockedExecSql) =>
        upsertDiscoveredDocuments(lockedExecSql, inputs),
      ),
    async verifyDiscoveredDocuments(...args) {
      const verification = await input.verifyDiscoveredDocuments(...args);
      return {
        ...verification,
        isCurrent: async () =>
          !input.isPaused() && (await verification.isCurrent()),
      };
    },
  };
}
