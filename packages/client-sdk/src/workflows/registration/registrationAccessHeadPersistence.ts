import {
  type AccessObjectKind,
  KeyingVerificationError,
  verifyAccessManifestLocalCheckpoint,
} from "@tearleads/crypto";
import {
  accessManifestObjectKey,
  loadStoredAccessManifestCheckpoint,
} from "../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  type LocallyAcknowledgedAccessManifestHead,
} from "../../data/persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence";
import { assertContainerNotRetired } from "../../data/persistence/principalKeys/principalGrantRetirementPersistence";
import { keyingCheckpointTables } from "../../data/sqlite/schema/keyingCheckpointSchema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";

/**
 * Genesis acknowledgements may fill absent pins, never replace newer ones.
 * Runs within the caller's guarded bootstrap transaction. Equal epochs still
 * go through normal fork verification; ordinary mutation rollback rules do not
 * change. The returned predicate also prevents stale bodies/keys/cache seeding.
 */
export async function seedRegistrationAccessHeads(input: {
  execSql: ExecSql;
  heads: readonly LocallyAcknowledgedAccessManifestHead[];
  organizationId: string;
}): Promise<(kind: AccessObjectKind, id: string) => boolean> {
  await ensureSqlTables(input.execSql, keyingCheckpointTables);
  const newer = new Set<string>();
  const seen = new Set<string>();
  const pending: LocallyAcknowledgedAccessManifestHead[] = [];
  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
      for (const head of input.heads) {
        const key = accessManifestObjectKey(head.checkpoint);
        if (seen.has(key)) {
          throw new KeyingVerificationError(
            "equivocation",
            "Registration repeats an access head",
          );
        }
        seen.add(key);
        if (
          head.checkpoint.epoch !== 1 ||
          head.previousManifestHash !== null ||
          head.checkpoint.organizationId !== input.organizationId
        ) {
          throw new KeyingVerificationError(
            "invalid_shape",
            "Registration must acknowledge this organization's genesis heads",
          );
        }
        await assertContainerNotRetired(tx, head.checkpoint);
        const local = await loadStoredAccessManifestCheckpoint(
          tx,
          head.checkpoint,
        );
        if (local && local.epoch > head.checkpoint.epoch) {
          // Validate the retained pin's shape without treating genesis as a
          // successor. Nothing from the response advances or overwrites this pin.
          verifyAccessManifestLocalCheckpoint({
            current: { ...local, previousManifestHash: null },
            localCheckpoint: local,
            checkpointPredecessors: [],
          });
          newer.add(key);
        } else {
          pending.push(head);
        }
      }
      await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        execSql: input.execSql,
        heads: pending,
      });
    },
  );
  return (objectKind, objectId) =>
    !newer.has(
      accessManifestObjectKey({
        objectKind,
        objectId,
        organizationId: input.organizationId,
      }),
    );
}
