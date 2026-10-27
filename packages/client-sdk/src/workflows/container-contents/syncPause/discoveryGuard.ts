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
 * Binds a discovery lane's writes to its generation and its organization staying
 * unpaused. Access changes and pauses invalidate in-flight listings, so the
 * apply stops at its next check, and each write it has
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
  const whileCurrent = <T>(
    skipped: T,
    write: (lockedExecSql: ExecSql) => Promise<T>,
    stillCurrent?: () => Promise<boolean>,
  ): Promise<T> =>
    runSerializedSqlMutation(input.execSql, async (lockedExecSql) =>
      input.isPaused() || (stillCurrent && !(await stillCurrent()))
        ? skipped
        : write(lockedExecSql),
    );
  return {
    replaceDocumentLinksBatch: (inputs, stillCurrent) =>
      whileCurrent(
        undefined,
        (lockedExecSql) =>
          sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
            lockedExecSql,
            inputs,
          ),
        stillCurrent,
      ),
    saveContainerDocumentWatermark: (containerId, watermark, stillCurrent) =>
      whileCurrent(
        undefined,
        async (lockedExecSql) => {
          await sqlContainerSyncWatermarkPersistence.saveWatermark(
            lockedExecSql,
            containerContentsSyncLane(containerId),
            watermark,
          );
        },
        stillCurrent,
      ),
    upsertDiscoveredDocuments: (inputs, stillCurrent) =>
      whileCurrent(
        [],
        (lockedExecSql) => upsertDiscoveredDocuments(lockedExecSql, inputs),
        stillCurrent,
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
