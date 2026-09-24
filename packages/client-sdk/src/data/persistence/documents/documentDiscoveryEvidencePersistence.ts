import { and, asc, eq, inArray, lte, min, sql } from "drizzle-orm";
import { readStringArray } from "../../recordReaders";
import {
  documentDiscoveryHeads,
  documentDiscoverySequence,
  pendingDocumentDiscoveries,
} from "../../sqlite/documentDiscoveryEvidenceSchema";
import { documentContainerProjectionTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import { loadDocumentPurgeCheckpoint } from "../documentPurgeCheckpointPersistence";

import {
  type DiscoveredDocumentCandidate,
  readStoredDiscoveryCandidate,
} from "./documentDiscoveryCandidate";

export type { DiscoveredDocumentCandidate } from "./documentDiscoveryCandidate";
export interface CachedDiscoveryHead {
  readonly accessEpoch: number;
  readonly accessStateHash?: string;
  readonly linkedContainerIds: readonly string[];
}
export interface DocumentDiscoveryEvidenceStore {
  begin(): Promise<number>;
  stage(
    inputs: readonly DiscoveredDocumentCandidate[],
    generation: number,
  ): Promise<void>;
  pending(
    containerIds: readonly string[],
    limit: number,
  ): Promise<readonly DiscoveredDocumentCandidate[]>;
  defer(input: DiscoveredDocumentCandidate): Promise<void>;
  acknowledge(inputs: readonly DiscoveredDocumentCandidate[]): Promise<void>;
  hasPending(containerIds: readonly string[]): Promise<boolean>;
  retryDelay(containerIds: readonly string[]): Promise<number | null>;
  loadHead(
    documentId: string,
    manifestHash: string | null | undefined,
  ): Promise<CachedDiscoveryHead | null>;
  saveHead(documentId: string, head: CachedDiscoveryHead): Promise<void>;
}

const pending = pendingDocumentDiscoveries;
const heads = documentDiscoveryHeads;
const RETRY_MS = 60_000;
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
  private write = async (
    operation: (
      db: ReturnType<typeof getClientSQLitePersistenceRuntime>["db"],
    ) => Promise<void>,
  ) =>
    runSerializedSqlMutation(this.execSql, async (locked) => {
      await ensureSqlTables(locked, documentContainerProjectionTables);
      await operation(getClientSQLitePersistenceRuntime(locked).db);
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
  stage = (
    inputs: readonly DiscoveredDocumentCandidate[],
    generation: number,
  ) =>
    this.write(async (db) => {
      await db.transaction(async (tx) => {
        for (const input of inputs)
          for (const containerId of input.listedContainerIds) {
            const rowInput = { ...input, containerId };
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
                },
                setWhere: lte(pending.generation, generation),
              })
              .run();
          }
      });
    });
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
  defer = (input: DiscoveredDocumentCandidate) =>
    this.write(async (db) => {
      await db
        .update(pending)
        .set({ retryAt: this.now() + RETRY_MS })
        .where(identity(input))
        .run();
    });
  acknowledge = (inputs: readonly DiscoveredDocumentCandidate[]) =>
    this.write(async (db) => {
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
  saveHead = (documentId: string, head: CachedDiscoveryHead) =>
    this.write(async (db) => {
      if (!head.accessStateHash) return;
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
    });
}

export function createDocumentDiscoveryEvidenceStore(
  execSql: ExecSql,
  now = Date.now,
): DocumentDiscoveryEvidenceStore {
  return new SqlDocumentDiscoveryEvidenceStore(execSql, now);
}
