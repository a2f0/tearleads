import { and, asc, eq, inArray, lte, min, or, sql } from "drizzle-orm";
import { uniqueSortedStrings } from "../../documents/shared/readers";
import { readStringArray } from "../../shared/recordReaders";
import {
  documentDiscoveryHeads,
  documentDiscoverySequence,
  pendingDocumentDiscoveries,
} from "../../sqlite/schema/documentDiscoveryEvidenceSchema";
import { documentContainerProjectionTables } from "../../sqlite/schema/documentProjectionSchema";
import {
  remoteResetBatches,
  sqliteInsertBatchSize,
} from "../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../../sqlite/sqliteUpsert";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import { KeyingCheckpointRepository } from "../keyingCheckpoints/keyingCheckpointRepository";
import { heldTombstoneRetryDelayMs } from "./containerDocumentTombstoneHoldsPersistence";
import {
  type DiscoveredDocumentCandidate,
  isDiscoveredDocumentCandidate,
  readStoredDiscoveryCandidate,
} from "./documentDiscoveryCandidate";
import { isDocumentDiscoveryGenerationCurrent } from "./documentDiscoveryReset";
import { placementPairsMatch } from "./internal/containerDocumentTombstoneHolds";

export type { DiscoveredDocumentCandidate } from "./documentDiscoveryCandidate";
export { clearDocumentDiscoveryEvidenceOnRemoteReset } from "./documentDiscoveryReset";
export interface CachedDiscoveryHead {
  readonly organizationId: string | null;
  readonly accessEpoch: number;
  readonly accessStateHash?: string;
  readonly linkedContainerIds: readonly string[];
}
interface RemovedDiscoveryPlacement {
  readonly containerId: string;
  readonly documentId: string;
}

const pending = pendingDocumentDiscoveries;
const heads = documentDiscoveryHeads;
const ID_BATCH_SIZE = 400;
const batches = (ids: readonly string[]) =>
  Array.from({ length: Math.ceil(ids.length / ID_BATCH_SIZE) }, (_, i) =>
    ids.slice(i * ID_BATCH_SIZE, (i + 1) * ID_BATCH_SIZE),
  );
const chunked = <T>(rows: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
    rows.slice(i * size, (i + 1) * size),
  );
const identity = (input: DiscoveredDocumentCandidate) =>
  and(
    eq(pending.containerId, input.containerId),
    eq(pending.documentId, input.documentId),
    eq(pending.inputJson, JSON.stringify(input)),
  );

/**
 * Untrusted document discovery evidence bound to one executor and clock. The
 * clock (epoch milliseconds, like the `retryAt` column) schedules and reports
 * pending-discovery retries.
 */
export class DocumentDiscoveryEvidenceRepository {
  constructor(
    private readonly execSql: ExecSql,
    private readonly now: () => number = Date.now,
    private readonly signal?: AbortSignal,
  ) {}

  private async read() {
    this.signal?.throwIfAborted();
    await ensureSqlTables(this.execSql, documentContainerProjectionTables);
    this.signal?.throwIfAborted();
    return getClientSQLitePersistenceRuntime(this.execSql).db;
  }
  private write<T>(
    operation: (
      db: ReturnType<typeof getClientSQLitePersistenceRuntime>["db"],
    ) => Promise<T>,
  ): Promise<T> {
    return runSerializedSqlMutation(this.execSql, async (locked) => {
      await ensureSqlTables(locked, documentContainerProjectionTables);
      this.signal?.throwIfAborted();
      return operation(getClientSQLitePersistenceRuntime(locked).db);
    });
  }
  async begin(): Promise<number> {
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
  }
  async isCurrent(generation: number): Promise<boolean> {
    return isDocumentDiscoveryGenerationCurrent(await this.read(), generation);
  }
  stage(
    inputs: readonly DiscoveredDocumentCandidate[],
    generation: number,
    removed: readonly RemovedDiscoveryPlacement[] = [],
    conflictingDocumentIds: ReadonlySet<string> = new Set(),
  ): Promise<boolean> {
    return this.write(async (db) => {
      if (!(await isDocumentDiscoveryGenerationCurrent(db, generation)))
        return false;
      if (!inputs.length && !removed.length && !conflictingDocumentIds.size)
        return true;
      await db.transaction(async (tx) => {
        const rows = inputs.flatMap((input) =>
          isDiscoveredDocumentCandidate(input)
            ? input.listedContainerIds.map((containerId) => ({
                containerId,
                documentId: input.documentId,
                accessEpoch: input.accessEpoch,
                generation,
                inputJson: JSON.stringify({
                  ...input,
                  containerId,
                  listedContainerIds: [containerId],
                }),
                retryAt: 0,
              }))
            : [],
        );
        // One multi-row upsert per chunk. SQLite applies a statement's rows
        // in order, so a repeated placement updates the row the previous
        // entry wrote, exactly as one statement per entry did.
        // A later listing can replace a pending hint while its unlink is
        // already behind the cursor. Keep the required current-head read.
        const nextInput = sql`case when json_extract(${pending.inputJson}, '$.requiresCurrentHead') then json_set(excluded.input_json, '$.requiresCurrentHead', json('true')) else excluded.input_json end`;
        const unchanged = sql`${pending.inputJson} = (${nextInput})`;
        for (const chunk of chunked(rows, sqliteInsertBatchSize(pending))) {
          await tx
            .insert(pending)
            .values(chunk)
            .onConflictDoUpdate({
              target: [pending.containerId, pending.documentId],
              set: {
                accessEpoch: excludedValue(pending.accessEpoch),
                generation: excludedValue(pending.generation),
                inputJson: nextInput,
                retryAt: sql`case when ${unchanged} then ${pending.retryAt} else 0 end`,
                attempts: sql`case when ${unchanged} then ${pending.attempts} else 0 end`,
              },
              setWhere: lte(pending.generation, generation),
            })
            .run();
        }
        for (const ids of batches([...conflictingDocumentIds])) {
          await tx
            .update(pending)
            .set({
              inputJson: sql`json_set(${pending.inputJson}, '$.requiresCurrentHead', json('true'))`,
            })
            .where(
              and(
                inArray(pending.documentId, ids),
                lte(pending.generation, generation),
              ),
            )
            .run();
        }
        // These are untrusted, unapplied hints only. Removing an existing local
        // placement still requires the separate signed tombstone evidence gate.
        for (const batch of remoteResetBatches(removed)) {
          await tx
            .delete(pending)
            .where(
              and(
                placementPairsMatch(
                  batch,
                  pending.documentId,
                  pending.containerId,
                ),
                lte(pending.generation, generation),
              ),
            )
            .run();
        }
      });
      return true;
    });
  }
  async pending(
    containerIds: readonly string[],
    limit: number,
  ): Promise<readonly DiscoveredDocumentCandidate[]> {
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
  }
  defer(input: DiscoveredDocumentCandidate, generation: number): Promise<void> {
    return this.write(async (db) => {
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
  }
  acknowledge(
    inputs: readonly DiscoveredDocumentCandidate[],
    generation: number,
  ): Promise<void> {
    return this.write(async (db) => {
      if (!(await isDocumentDiscoveryGenerationCurrent(db, generation))) return;
      await db.transaction(async (tx) => {
        for (const batch of remoteResetBatches(inputs))
          await tx
            .delete(pending)
            .where(or(...batch.map(identity)))
            .run();
      });
    });
  }
  async hasPending(containerIds: readonly string[]): Promise<boolean> {
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
  }
  async retryDelay(containerIds: readonly string[]): Promise<number | null> {
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
  }
  async loadHead(
    documentId: string,
    manifestHash: string | null | undefined,
  ): Promise<CachedDiscoveryHead | null> {
    if (
      await new KeyingCheckpointRepository(
        this.execSql,
      ).loadDocumentPurgeCheckpoint(documentId)
    )
      return {
        organizationId: null,
        accessEpoch: Number.MAX_SAFE_INTEGER,
        linkedContainerIds: [],
      };
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
    if (!row) return null;
    // A different verifier (for example tombstone removal) can advance the
    // signed checkpoint without updating documents.accessEpoch or this cache.
    // Old-organization pins survive recovery; only the cached signed head's
    // organization can authorize reuse. Missing pins require full verification.
    const checkpoint = await new KeyingCheckpointRepository(
      this.execSql,
    ).loadAccessManifestCheckpoint("document", row.organizationId, documentId);
    if (
      checkpoint?.manifestHash !== row.manifestHash ||
      checkpoint.epoch !== row.accessEpoch
    )
      return null;
    return {
      organizationId: row.organizationId,
      accessEpoch: row.accessEpoch,
      accessStateHash: row.manifestHash,
      linkedContainerIds: readStringArray(
        JSON.parse(row.linksJson),
        "stored discovery links",
      ),
    };
  }
  saveHead(
    documentId: string,
    head: CachedDiscoveryHead,
    generation: number,
  ): Promise<boolean> {
    return this.write(async (db) => {
      if (
        !head.accessStateHash ||
        !head.organizationId ||
        !(await isDocumentDiscoveryGenerationCurrent(db, generation))
      )
        return false;
      const row = {
        documentId,
        organizationId: head.organizationId,
        manifestHash: head.accessStateHash,
        accessEpoch: head.accessEpoch,
        linksJson: JSON.stringify(head.linkedContainerIds),
      };
      await db
        .insert(heads)
        .values(row)
        .onConflictDoUpdate({
          target: [heads.documentId, heads.organizationId],
          set: row,
          setWhere: lte(heads.accessEpoch, head.accessEpoch),
        })
        .run();
      return true;
    });
  }
}

/**
 * A document head this client signed, already checked against the server's
 * create acknowledgement and pinned as its access-manifest checkpoint in the
 * same transaction. It is the same signed head a discovery projection would
 * verify, so it seeds the exact-head cache; `loadHead` still reuses it only
 * while that checkpoint matches.
 */
export interface AuthoredDiscoveryHead {
  readonly documentId: string;
  readonly organizationId: string;
  readonly accessEpoch: number;
  readonly accessStateHash: string;
  readonly linkedContainerIds: readonly string[];
}

/** Writes authored heads inside the caller's serialized write transaction. */
export async function primeAuthoredDocumentDiscoveryHeads(
  execSql: ExecSql,
  authored: readonly AuthoredDiscoveryHead[],
): Promise<void> {
  const db = getClientSQLitePersistenceRuntime(execSql).db;
  for (const head of authored) {
    const row = {
      documentId: head.documentId,
      organizationId: head.organizationId,
      manifestHash: head.accessStateHash,
      accessEpoch: head.accessEpoch,
      linksJson: JSON.stringify(uniqueSortedStrings(head.linkedContainerIds)),
    };
    await db
      .insert(heads)
      .values(row)
      .onConflictDoUpdate({
        target: [heads.documentId, heads.organizationId],
        set: row,
        setWhere: lte(heads.accessEpoch, head.accessEpoch),
      })
      .run();
  }
}
