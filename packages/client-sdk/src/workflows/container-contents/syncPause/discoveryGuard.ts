import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import {
  DocumentContainerProjectionRepository,
  deleteContainerDocumentTombstonePlacementRows,
} from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { ContainerDocumentTombstoneHoldRepository } from "../../../data/persistence/documents/containerDocumentTombstoneHoldRepository";
import {
  applyContainerDocumentTombstones,
  upsertDiscoveredDocuments,
} from "../../../data/persistence/documents/documentsPersistence";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { oweListedDocumentReadsBehindListing } from "../../documents";
import type { DiscoverContainerDocumentsOptions } from "../documentDiscovery/documentDiscoveryTypes";

type PauseGuardedDiscovery = Pick<
  DiscoverContainerDocumentsOptions,
  | "applyContainerDocumentTombstones"
  | "holdContainerDocumentTombstones"
  | "oweListedDocumentReads"
  | "refuteContainerDocumentTombstoneHolds"
  | "recordContainerDocumentListing"
  | "replaceDocumentLinksBatch"
  | "upsertDiscoveredDocuments"
  | "verifyDiscoveredDocuments"
>;

type ListedDocuments = Parameters<
  DiscoverContainerDocumentsOptions["oweListedDocumentReads"]
>[0];

/** The owed-read write for one listing, run on the locked executor. */
const oweReads = (listed: ListedDocuments) => (locked: ExecSql) =>
  oweListedDocumentReadsBehindListing(locked, listed);

/**
 * Binds a discovery lane's writes to its generation and its organization
 * staying unpaused. Access changes and pauses invalidate in-flight listings,
 * so the apply stops at its next check, and each write already started
 * rechecks under the SQLite mutation lock. A listing that verified before
 * its organization paused therefore saves no watermark: a watermark saved
 * past documents it did not apply would let the listing after a resume skip
 * them.
 */
export function guardDocumentDiscoveryWrites(input: {
  readonly execSql: ExecSql;
  readonly isPaused: () => boolean;
  readonly verifyDiscoveredDocuments: DiscoverContainerDocumentsOptions["verifyDiscoveredDocuments"];
}): PauseGuardedDiscovery {
  const whileCurrent = <T>(
    skipped: T,
    write: (lockedExecSql: ExecSql) => Promise<T>,
    stillCurrent: () => Promise<boolean>,
  ): Promise<T> =>
    runSerializedSqlMutation(input.execSql, async (lockedExecSql) =>
      input.isPaused() || !(await stillCurrent())
        ? skipped
        : write(lockedExecSql),
    );
  return {
    applyContainerDocumentTombstones: (rows, stillCurrent) =>
      whileCurrent(
        [],
        (locked) =>
          applyContainerDocumentTombstones(
            locked,
            rows,
            deleteContainerDocumentTombstonePlacementRows,
          ),
        stillCurrent,
      ),
    holdContainerDocumentTombstones: (rows, stillCurrent) =>
      whileCurrent(
        undefined,
        (locked) =>
          new ContainerDocumentTombstoneHoldRepository(
            locked,
          ).holdContainerDocumentTombstones(rows),
        stillCurrent,
      ),
    oweListedDocumentReads: (listed, stillCurrent) =>
      whileCurrent([], oweReads(listed), stillCurrent),
    refuteContainerDocumentTombstoneHolds: (rows, stillCurrent) =>
      whileCurrent(
        undefined,
        (locked) =>
          new ContainerDocumentTombstoneHoldRepository(
            locked,
          ).refuteContainerDocumentTombstoneHolds(rows),
        stillCurrent,
      ),
    replaceDocumentLinksBatch: (inputs, stillCurrent) =>
      whileCurrent(
        undefined,
        (lockedExecSql) =>
          new DocumentContainerProjectionRepository(
            lockedExecSql,
          ).replaceDocumentLinksBatch(inputs),
        stillCurrent,
      ),
    recordContainerDocumentListing: (containerId, listing, stillCurrent) =>
      whileCurrent(
        undefined,
        async (lockedExecSql) => {
          await new ContainerSyncWatermarkRepository(
            lockedExecSql,
          ).recordLaneFetch(containerContentsSyncLane(containerId), {
            checked: listing.settled,
            watermark: listing.watermark,
          });
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
