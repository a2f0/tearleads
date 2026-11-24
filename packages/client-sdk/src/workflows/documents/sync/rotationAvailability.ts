import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  currentRotationAvailability,
  MAX_ROTATION_DEATHS,
  type RotationJudgement,
  transitionRotationAvailability,
} from "../../../data/documents/shared/sync/rotationAvailabilityMachine";
import type { DocumentScope } from "../../../data/persistence/documents/records";
import {
  readRotationAvailability,
  writeRotationAvailabilityInTransaction,
} from "../../../data/persistence/documents/records/rotationAvailabilityPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import { claimDocumentSyncOrphanWindows } from "./loroWindows";

/**
 * Whether this device starts a key rotation of a document (#3194). Deaths in
 * a rotation's history rebuild count toward the rotation, never an update
 * (`rotationAvailabilityMachine.ts`); at the limit the device leaves the
 * document's rotations to other members, which never wait on it.
 */

export class DocumentRotationUnavailableError extends Error {
  constructor() {
    super(
      `This device stopped rotating this document's key after rebuilding its history ended the process ${MAX_ROTATION_DEATHS} times; other members can rotate it`,
    );
    this.name = "DocumentRotationUnavailableError";
  }
}

function judgementOf(documentId: string): RotationJudgement {
  return { documentId, judge: documentVerdictJudge() };
}

/**
 * Claims the windows ended lifetimes left on the scope, so a rotation death
 * the last lifetime met is counted, then refuses a rotation this device no
 * longer starts under the running judge.
 */
export async function claimThenAssertDocumentRotationAvailable(
  input: Parameters<typeof claimDocumentSyncOrphanWindows>[0],
): Promise<void> {
  await claimDocumentSyncOrphanWindows(input);
  const availability = currentRotationAvailability(
    await readRotationAvailability(
      getClientSQLitePersistenceRuntime(input.execSql).db,
      input.scope,
    ),
    judgementOf(input.documentId),
  );
  if (availability.status === "unavailable") {
    throw new DocumentRotationUnavailableError();
  }
}

/**
 * Notes a rotation that rebuilt the document's whole history: the deaths
 * counted before it, below the limit, were not the rebuild's to keep.
 */
export async function noteDocumentRotationRebuilt(input: {
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly isCurrent: () => boolean;
  readonly scope: DocumentScope;
}): Promise<void> {
  const stored = await readRotationAvailability(
    getClientSQLitePersistenceRuntime(input.execSql).db,
    input.scope,
  );
  if (stored.status === "available") return;
  await runSerializedSqlMutation(input.execSql, (locked) =>
    getClientSQLitePersistenceRuntime(locked).guardedTransaction(async (tx) => {
      // Read again under the lock: another tab may have counted a death.
      const current = await readRotationAvailability(tx, input.scope);
      const next = transitionRotationAvailability(current, {
        ...judgementOf(input.documentId),
        type: "rotationRebuilt",
      });
      if (next === current) return;
      await writeRotationAvailabilityInTransaction(
        tx,
        input.scope,
        next,
        new Date().toISOString(),
      );
    }, input.isCurrent),
  );
}
