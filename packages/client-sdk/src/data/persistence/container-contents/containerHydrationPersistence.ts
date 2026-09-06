import { compareIsoTimestamps } from "@tearleads/validators/util";
import { eq, type SQL, sql } from "drizzle-orm";
import { documentSyncPullContinuationsEqual } from "../../documents/shared/pullContinuation";
import { containerHydrationTombstones, containers } from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import type {
  ContainerContentsPersistence,
  ContainerHydrationTombstone,
  ContainerMetadataRecord,
} from "./containerContentsPersistenceTypes";
import {
  saveContainerContentsContainerRows,
  selectContainerMetadataRecord,
} from "./containerMetadataRows";
import { deleteContainerMetadataDocumentRowsInTransaction } from "./dormantContainerMetadata";

function sameNullableValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function sameMetadataRecord(
  current: ContainerMetadataRecord | null,
  expected: ContainerMetadataRecord | null,
): boolean {
  if (!current || !expected) return current === expected;
  return (
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    current.accessEpoch === expected.accessEpoch &&
    sameNullableValue(current.accessStateHash, expected.accessStateHash) &&
    sameNullableValue(current.lastCommitLsn, expected.lastCommitLsn) &&
    sameNullableValue(current.contentKeyBundle, expected.contentKeyBundle) &&
    sameNullableValue(
      current.documentKekTargets,
      expected.documentKekTargets,
    ) &&
    sameNullableValue(
      current.documentManifestBundle,
      expected.documentManifestBundle,
    ) &&
    current.metadataUpdates === expected.metadataUpdates &&
    current.snapshotEndVersion === expected.snapshotEndVersion &&
    documentSyncPullContinuationsEqual(
      current.pullContinuation,
      expected.pullContinuation,
    ) &&
    Boolean(current.pullContinuationRecoveryRequired) ===
      Boolean(expected.pullContinuationRecoveryRequired)
  );
}

function sameHydrationTombstone(
  current:
    | { generation: number; reason: string; updatedAt: string }
    | undefined,
  expected: ContainerHydrationTombstone | null | undefined,
): boolean {
  return (
    current !== undefined &&
    expected != null &&
    current.generation === expected.generation &&
    current.reason === expected.reason &&
    current.updatedAt === expected.updatedAt
  );
}

// Local/server timestamps are canonical UTC strings with 3 or 6 fractional
// digits. Pad the comparison key, retaining the original stored representation.
function timestampOrderKey(timestamp: SQL): SQL {
  return sql`rtrim(${timestamp}, 'Z') || substr('000000', 1, 27 - length(${timestamp}))`;
}

export async function recordContainerHydrationTombstones(input: {
  removals: ReadonlyArray<{
    containerId: string;
    reason: "access_revoked" | "deleted";
    updatedAt: string;
  }>;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  if (input.removals.length === 0) return;
  await input.tx
    .insert(containerHydrationTombstones)
    .values([...input.removals])
    .onConflictDoUpdate({
      target: containerHydrationTombstones.containerId,
      set: {
        generation: sql`${containerHydrationTombstones.generation} + 1`,
        reason: sql`CASE
          WHEN ${containerHydrationTombstones.reason} = 'deleted' THEN 'deleted'
          ELSE excluded.reason
        END`,
        updatedAt: sql`CASE
          WHEN ${timestampOrderKey(sql`${containerHydrationTombstones.updatedAt}`)} >= ${timestampOrderKey(sql`excluded.updated_at`)}
          THEN ${containerHydrationTombstones.updatedAt}
          ELSE excluded.updated_at
        END`,
      },
    })
    .run();
}

export async function commitStoredHydratedContainer(
  execSql: Parameters<
    ContainerContentsPersistence["commitHydratedContainer"]
  >[0],
  input: Parameters<ContainerContentsPersistence["commitHydratedContainer"]>[1],
) {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
    const commit = async (tx: ClientSQLiteTransactionScope) => {
      const existingContainers = await tx
        .select({ id: containers.id })
        .from(containers)
        .where(eq(containers.id, input.container.id))
        .limit(1);
      if (existingContainers.length > 0) return { committed: false as const };

      const fences = await tx
        .select({
          generation: containerHydrationTombstones.generation,
          reason: containerHydrationTombstones.reason,
          updatedAt: containerHydrationTombstones.updatedAt,
        })
        .from(containerHydrationTombstones)
        .where(eq(containerHydrationTombstones.containerId, input.container.id))
        .limit(1);
      const fence = fences[0];
      const currentDormantRecord = await selectContainerMetadataRecord(
        lockedExecSql,
        input.container.id,
      );
      if (
        fence &&
        compareIsoTimestamps(fence.updatedAt, input.remoteUpdatedAt) >= 0 &&
        (fence.reason === "deleted" ||
          !sameHydrationTombstone(fence, input.expectedHydrationTombstone))
      ) {
        return { committed: false as const };
      }
      if (
        !sameMetadataRecord(currentDormantRecord, input.expectedDormantRecord)
      ) {
        return { committed: false as const };
      }
      if (input.purgeDormantMetadata) {
        await deleteContainerMetadataDocumentRowsInTransaction(tx, [
          input.container.id,
        ]);
      }

      const localUpdatedAt =
        input.saveOptions.localUpdatedAt ?? input.remoteUpdatedAt;
      const container = await saveContainerContentsContainerRows({
        container: input.container,
        localUpdatedAt,
        record: input.record,
        serverTimestamps: input.saveOptions.serverTimestamps,
        tx,
      });
      await tx
        .delete(containerHydrationTombstones)
        .where(eq(containerHydrationTombstones.containerId, input.container.id))
        .run();
      return { committed: true as const, container };
    };
    if (!input.stillCurrent) {
      return runtime.transaction(commit, { behavior: "immediate" });
    }
    const outcome = await runtime.guardedTransaction(
      commit,
      input.stillCurrent,
      { behavior: "immediate" },
    );
    return outcome.result ?? { committed: false as const };
  });
}
