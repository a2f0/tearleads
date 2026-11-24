import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  currentRotationAvailability,
  MAX_ROTATION_DEATHS,
  type RotationAvailability,
  type RotationJudgement,
  rotationIsolates,
  rotationLeftOut,
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
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";
import {
  claimDocumentSyncOrphanWindows,
  claimThenReadDocumentSyncPageLimit,
  ROTATION_UNAVAILABLE_NOTE,
} from "./loroWindows";
import { reportQuietly } from "./reportQuietly";

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

/** Where a rotation of a document runs, and whether it is still current. */
interface RotationScopeInput {
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly isCurrent: () => boolean;
  readonly scope: DocumentScope;
}

/**
 * Applies `type` to the scope's stored rotation availability under the
 * running judge, and returns the state it wrote, or null for no change.
 */
async function applyRotationEvent(
  input: RotationScopeInput,
  event:
    | { readonly type: "rotationRebuilt" }
    | {
        readonly leftOut: readonly string[];
        readonly type: "rotationDiverged" | "rotationProven";
      },
): Promise<RotationAvailability | null> {
  const stored = await readRotationAvailability(
    getClientSQLitePersistenceRuntime(input.execSql).db,
    input.scope,
  );
  if (stored.status === "available") return null;
  let written: RotationAvailability | null = null;
  await runSerializedSqlMutation(input.execSql, (locked) =>
    getClientSQLitePersistenceRuntime(locked).guardedTransaction(async (tx) => {
      // Read again under the lock: another tab may have counted a death.
      const current = await readRotationAvailability(tx, input.scope);
      const next = transitionRotationAvailability(current, {
        ...judgementOf(input.documentId),
        ...event,
      });
      if (next === current) return;
      await writeRotationAvailabilityInTransaction(
        tx,
        input.scope,
        next,
        new Date().toISOString(),
      );
      written = next;
    }, input.isCurrent),
  );
  return written;
}

/**
 * Notes a rotation that rebuilt the document's whole history: the deaths
 * counted before it, below the limit, were not the rebuild's to keep.
 */
export async function noteDocumentRotationRebuilt(
  input: RotationScopeInput,
): Promise<void> {
  await applyRotationEvent(input, { type: "rotationRebuilt" });
}

/** What a rotation's rebuild left out, unread (`readDocumentRotationLeftOut`). */
interface RebuildInput extends RotationScopeInput {
  readonly leftOut: readonly string[];
}

/**
 * Notes a rotation that installed a rebuild equal to the live document: one
 * leaving an update out shows the device never held that update.
 */
export async function noteDocumentRotationProven(
  input: RebuildInput,
): Promise<void> {
  await applyRotationEvent(input, {
    leftOut: input.leftOut,
    type: "rotationProven",
  });
}

/**
 * Notes a rebuild whose history did not equal the live document's. One
 * that left an update out shows the device holds that update, so the deaths
 * were the rebuild's: this device starts no more rotations of the document.
 */
export async function noteDocumentRotationDiverged(
  input: RebuildInput & {
    readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
  },
): Promise<void> {
  const written = await applyRotationEvent(input, {
    leftOut: input.leftOut,
    type: "rotationDiverged",
  });
  if (written?.status !== "unavailable" || !input.isCurrent()) return;
  reportQuietly(
    input.logError,
    `Documents: a key rotation's rebuild leaving out the update it died reading did not match this device's history; ${ROTATION_UNAVAILABLE_NOTE}`,
    new Error(`Rotation rebuild diverged: ${input.documentId}`),
  );
}

/**
 * The updates a rotation of the document leaves out of its rebuild under
 * the running judge, unread (`rotationLeftOut`).
 */
export async function readDocumentRotationLeftOut(input: {
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly scope: DocumentScope;
}): Promise<readonly string[]> {
  return rotationLeftOut(await readCurrentRotationAvailability(input));
}

async function readCurrentRotationAvailability(input: {
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly scope: DocumentScope;
}): Promise<RotationAvailability> {
  return currentRotationAvailability(
    await readRotationAvailability(
      getClientSQLitePersistenceRuntime(input.execSql).db,
      input.scope,
    ),
    judgementOf(input.documentId),
  );
}

/**
 * The page limit a rotation's raw pull asks for, once the windows ended
 * lifetimes left on its scope are claimed. While deaths stand against the
 * rotation it reads one update a page whatever the scope's suspects, which
 * a completed sync pull clears, so each further death names one update.
 */
export async function claimThenReadDocumentRotationPageLimit(
  input: Parameters<typeof claimThenReadDocumentSyncPageLimit>[0],
): Promise<1 | undefined> {
  const limit = await claimThenReadDocumentSyncPageLimit(input);
  return (
    limit ??
    (rotationIsolates(await readCurrentRotationAvailability(input))
      ? 1
      : undefined)
  );
}
