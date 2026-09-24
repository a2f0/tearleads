import { and, asc, eq, inArray, lte, min, sql } from "drizzle-orm";
import { readStringArray } from "../../recordReaders";
import {
  documentDiscoveryHeads,
  documentDiscoverySequence,
  pendingDocumentDiscoveries,
} from "../../sqlite/documentDiscoveryEvidenceSchema";
import {
  accessManifestCheckpoints,
  documentContainerProjectionTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import { loadDocumentPurgeCheckpoint } from "../documentPurgeCheckpointPersistence";
import { heldTombstoneRetryDelayMs } from "./containerDocumentTombstoneHoldsPersistence";

import {
  type DiscoveredDocumentCandidate,
  isDiscoveredDocumentCandidate,
  readStoredDiscoveryCandidate,
} from "./documentDiscoveryCandidate";

import { isDocumentDiscoveryGenerationCurrent } from "./documentDiscoveryReset";

export type { DiscoveredDocumentCandidate } from "./documentDiscoveryCandidate";
export interface CachedDiscoveryHead {
  readonly accessEpoch: number;
  readonly accessStateHash?: string;
  readonly linkedContainerIds: readonly string[];
}
interface RemovedDiscoveryPlacement {
  readonly containerId: string;
  readonly documentId: string;
}
export interface DocumentDiscoveryEvidenceStore {
  begin(): Promise<number>;
  isCurrent(generation: number): Promise<boolean>;
  stage(
    inputs: readonly DiscoveredDocumentCandidate[],
    generation: number,
    removed?: readonly RemovedDiscoveryPlacement[],
  ): Promise<boolean>;
  pending(
    containerIds: readonly string[],
    limit: number,
  ): Promise<readonly DiscoveredDocumentCandidate[]>;
  defer(input: DiscoveredDocumentCandidate, generation: number): Promise<void>;
  acknowledge(
    inputs: readonly DiscoveredDocumentCandidate[],
    generation: number,
  ): Promise<void>;
  hasPending(containerIds: readonly string[]): Promise<boolean>;
  retryDelay(containerIds: readonly string[]): Promise<number | null>;
  loadHead(
    documentId: string,
    manifestHash: string | null | undefined,
  ): Promise<CachedDiscoveryHead | null>;
  saveHead(
    documentId: string,
    head: CachedDiscoveryHead,
    generation: number,
  ): Promise<boolean>;
}

const pending = pendingDocumentDiscoveries;
const heads = documentDiscoveryHeads;
const ID_BATCH_SIZE = 400;
const batches = (ids: readonly string[]) =>
  Array.from({ length: Math.ceil(ids.length / ID_BATCH_SIZE) }, (_, i) =>
    ids.slice(i * ID_BATCH_SIZE, (i + 1) * ID_BATCH_SIZE),
  );
const identity = (input: DiscoveredDocumentCandidate) =>
  and(
    eq(pending.containerId, input.containerId),
    eq(pending.documentId, input.documentId),
    eq(pending.inputJson, JSON.stringify(input)),
  );

class SqlDocumentDiscoveryEvidenceStore
  implements DocumentDiscoveryEvidenceStore
{
  constructor(
    private readonly execSql: ExecSql,
    private readonly now: () => number,
  ) {}

  private read = async () => {
    await ensureSqlTables(this.execSql, documentContainerProjectionTables);
    return getClientSQLitePersistenceRuntime(this.execSql).db;
  };
  private write = async <T>(
    operation: (
      db: ReturnType<typeof getClientSQLitePersistenceRuntime>["db"],
    ) => Promise<T>,
  ) =>
    runSerializedSqlMutation(this.execSql, async (locked) => {
      await ensureSqlTables(locked, documentContainerProjectionTables);
      return operation(getClientSQLitePersistenceRuntime(locked).db);
    });
  begin = async () => {
    let generation = 0;
    await this.write(async (db) => {
      const [row] = await db
        .insert(documentDiscoverySequence)
        .values({ id: "requests", generation: 1 })
        .onConflictDoUpdate({
          target: documentDiscoverySequence.id,
          set: {
            generation: sql`${documentDiscoverySequence.generation} + 1`,
          },
        })
        .returning({ generation: documentDiscoverySequence.generation });
      if (!row || !Number.isSafeInteger(row.generation))
        throw new Error("Document discovery generation is exhausted");
      generation = row.generation;
    });
    return generation;
  };
  isCurrent = async (generation: number) =>
    isDocumentDiscoveryGenerationCurrent(await this.read(), generation);
  stage = (
    inputs: readonly DiscoveredDocumentCandidate[],
    generation: number,
    removed: readonly RemovedDiscoveryPlacement[] = [],
  ) => {
    return this.write(async (db) => {
      if (!(await isDocumentDiscoveryGenerationCurrent(db, generation)))
        return false;
      if (inputs.length === 0 && removed.length === 0) return true;
      await db.transaction(async (tx) => {
        for (const input of inputs) {
          if (!isDiscoveredDocumentCandidate(input)) continue;
          for (const containerId of input.listedContainerIds) {
            const rowInput = {
              ...input,
              containerId,
              listedContainerIds: [containerId],
            };
            const inputJson = JSON.stringify(rowInput);
            await tx
              .insert(pending)
              .values({
                containerId,
                documentId: input.documentId,
                accessEpoch: input.accessEpoch,
                generation,
                inputJson,
                retryAt: 0,
              })
              .onConflictDoUpdate({
                target: [pending.containerId, pending.documentId],
                set: {
                  accessEpoch: input.accessEpoch,
                  generation,
                  inputJson,
                  retryAt: sql`case when ${pending.inputJson} = ${inputJson} then ${pending.retryAt} else 0 end`,
                  attempts: sql`case when ${pending.inputJson} = ${inputJson} then ${pending.attempts} else 0 end`,
                },
                setWhere: lte(pending.generation, generation),
              })
              .run();
          }
        }
        // These are untrusted, unapplied hints only. Removing an existing local
        // placement still requires the separate signed tombstone evidence gate.
        for (const row of removed) {
          await tx
            .delete(pending)
            .where(
              and(
                eq(pending.containerId, row.containerId),
                eq(pending.documentId, row.documentId),
                lte(pending.generation, generation),
              ),
            )
            .run();
        }
      });
      return true;
    });
  };
  pending = async (containerIds: readonly string[], limit: number) => {
    const db = await this.read();
    const result: DiscoveredDocumentCandidate[] = [];
    for (const batch of batches(containerIds)) {
      if (result.length >= limit) break;
      const rows = await db
        .select({ inputJson: pending.inputJson })
        .from(pending)
        .where(
          and(
            inArray(pending.containerId, [...batch]),
            lte(pending.retryAt, this.now()),
          ),
        )
        .orderBy(asc(pending.retryAt), asc(pending.documentId))
        .limit(limit - result.length);
      result.push(
        ...rows.map((row) => readStoredDiscoveryCandidate(row.inputJson)),
      );
    }
    return result;
  };
  defer = (input: DiscoveredDocumentCandidate, generation: number) =>
    this.write(async (db) => {
      if (!(await isDocumentDiscoveryGenerationCurrent(db, generation))) return;
      const [row] = await db
        .select({ attempts: pending.attempts })
        .from(pending)
        .where(identity(input))
        .limit(1);
      if (!row) return;
      const attempts = Math.min(row.attempts + 1, 8);
      await db
        .update(pending)
        .set({
          attempts,
          retryAt: this.now() + heldTombstoneRetryDelayMs(attempts),
        })
        .where(identity(input))
        .run();
    });
  acknowledge = (
    inputs: readonly DiscoveredDocumentCandidate[],
    generation: number,
  ) =>
    this.write(async (db) => {
      if (!(await isDocumentDiscoveryGenerationCurrent(db, generation))) return;
      await db.transaction(async (tx) => {
        for (const input of inputs)
          await tx.delete(pending).where(identity(input)).run();
      });
    });
  hasPending = async (containerIds: readonly string[]) => {
    const db = await this.read();
    for (const batch of batches(containerIds)) {
      if (
        (
          await db
            .select({ documentId: pending.documentId })
            .from(pending)
            .where(inArray(pending.containerId, [...batch]))
            .limit(1)
        ).length
      )
        return true;
    }
    return false;
  };
  retryDelay = async (containerIds: readonly string[]) => {
    const db = await this.read();
    let due: number | null = null;
    for (const batch of batches(containerIds)) {
      const [row] = await db
        .select({ due: min(pending.retryAt) })
        .from(pending)
        .where(inArray(pending.containerId, [...batch]));
      if (row?.due !== null && row?.due !== undefined)
        due = Math.min(due ?? row.due, row.due);
    }
    return due === null ? null : Math.max(0, due - this.now());
  };
  loadHead = async (
    documentId: string,
    manifestHash: string | null | undefined,
  ) => {
    if (await loadDocumentPurgeCheckpoint(this.execSql, documentId))
      return { accessEpoch: Number.MAX_SAFE_INTEGER, linkedContainerIds: [] };
    if (!manifestHash) return null;
    const db = await this.read();
    const [row] = await db
      .select()
      .from(heads)
      .where(
        and(
          eq(heads.documentId, documentId),
          eq(heads.manifestHash, manifestHash),
        ),
      )
      .limit(1);
    // A different verifier (for example tombstone removal) can advance the
    // signed checkpoint without updating documents.accessEpoch or this cache.
    // Missing or ambiguous pins also require full projection verification.
    const checkpoints = await db
      .select()
      .from(accessManifestCheckpoints)
      .where(
        and(
          eq(accessManifestCheckpoints.objectKind, "document"),
          eq(accessManifestCheckpoints.objectId, documentId),
        ),
      )
      .limit(2);
    if (
      checkpoints.length !== 1 ||
      checkpoints[0]?.manifestHash !== row?.manifestHash ||
      checkpoints[0]?.epoch !== row?.accessEpoch
    )
      return null;
    return row
      ? {
          accessEpoch: row.accessEpoch,
          accessStateHash: row.manifestHash,
          linkedContainerIds: readStringArray(
            JSON.parse(row.linksJson),
            "stored discovery links",
          ),
        }
      : null;
  };
  saveHead = (
    documentId: string,
    head: CachedDiscoveryHead,
    generation: number,
  ) =>
    this.write(async (db) => {
      if (
        !head.accessStateHash ||
        !(await isDocumentDiscoveryGenerationCurrent(db, generation))
      )
        return false;
      const row = {
        documentId,
        manifestHash: head.accessStateHash,
        accessEpoch: head.accessEpoch,
        linksJson: JSON.stringify(head.linkedContainerIds),
      };
      await db
        .insert(heads)
        .values(row)
        .onConflictDoUpdate({
          target: heads.documentId,
          set: row,
          setWhere: lte(heads.accessEpoch, head.accessEpoch),
        })
        .run();
      return true;
    });
}

export function createDocumentDiscoveryEvidenceStore(
  execSql: ExecSql,
  now = Date.now,
): DocumentDiscoveryEvidenceStore {
  return new SqlDocumentDiscoveryEvidenceStore(execSql, now);
}
