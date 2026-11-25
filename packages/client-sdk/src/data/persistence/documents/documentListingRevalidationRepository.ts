import { satisfiesVersionVector } from "@tearleads/loro";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import { documentListingRevalidations } from "../../sqlite/schema/documentListingRevalidationSchema";
import {
  documents,
  documentTables,
} from "../../sqlite/schema/documentRecordSchema";
import { documentSyncProgress } from "../../sqlite/schema/documentSyncVerdictSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

/** An ordinary document owed a remote read, and the request's revision. */
export interface DocumentListingRevalidation {
  /** The most updates a listing counted; a read must cover at least these. */
  readonly advertisedUpdateCount: number;
  readonly documentId: string;
  readonly revision: string;
}

/** A document as a container listing counted it. */
export interface ListedDocumentUpdateCount {
  readonly documentId: string;
  readonly updateCount: number;
}

const ID_BATCH_SIZE = 400;

function batches<T>(values: readonly T[]): T[][] {
  return Array.from(
    { length: Math.ceil(values.length / ID_BATCH_SIZE) },
    (_, index) =>
      values.slice(index * ID_BATCH_SIZE, (index + 1) * ID_BATCH_SIZE),
  );
}

/**
 * Whether a record's processed cursor covers `updateCount`: the running
 * `judge` reached it for the record's server document, the record's persisted
 * frontier still covers the version recorded with it, and its pull counted at
 * least that many updates.
 */
function cursorCovers(
  row: {
    readonly documentId: string | null;
    readonly frontier: string;
    readonly judge: string | null;
    readonly progressDocumentId: string | null;
    readonly throughUpdateCount: number | null;
    readonly throughUpdateId: string | null;
    readonly throughVersion: string | null;
  },
  judge: string,
  updateCount: number,
): boolean {
  if (
    row.throughUpdateId === null ||
    row.throughVersion === null ||
    row.throughUpdateCount === null ||
    row.frontier === ""
  ) {
    return false;
  }
  return (
    row.progressDocumentId === row.documentId &&
    row.judge === judge &&
    row.throughUpdateCount >= updateCount &&
    satisfiesVersionVector(row.frontier, row.throughVersion)
  );
}

/**
 * Reads owed to ordinary documents, bound to one executor and clock. See
 * `document_listing_revalidations` for what a row means.
 */
export class DocumentListingRevalidationRepository {
  constructor(
    private readonly execSql: ExecSql,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async db() {
    await ensureSqlTables(this.execSql, documentTables);
    return getClientSQLitePersistenceRuntime(this.execSql).db;
  }

  /**
   * The listed documents this device holds whose processed cursor does not
   * cover the count the listing advertised. A cursor counts only when the
   * running `judge` reached it for this server document and the record's
   * persisted frontier still covers the version recorded with it, which are
   * the rules for sending it. A document with no update owes nothing, and
   * one this device holds no record of is left to its first open, which
   * always pulls.
   */
  async listBehindCursor(
    listed: ReadonlyArray<ListedDocumentUpdateCount>,
    judge: string,
  ): Promise<ReadonlyArray<ListedDocumentUpdateCount>> {
    const advertised = new Map<string, number>();
    for (const { documentId, updateCount } of listed) {
      if (updateCount > (advertised.get(documentId) ?? 0)) {
        advertised.set(documentId, updateCount);
      }
    }
    if (advertised.size === 0) return [];
    const db = await this.db();
    const behind = new Set<string>();
    for (const documentIds of batches([...advertised.keys()])) {
      const rows = await db
        .select({
          documentId: documents.documentId,
          frontier: documents.snapshotEndVersion,
          judge: documentSyncProgress.judge,
          progressDocumentId: documentSyncProgress.documentId,
          throughUpdateCount: documentSyncProgress.throughUpdateCount,
          throughUpdateId: documentSyncProgress.throughUpdateId,
          throughVersion: documentSyncProgress.throughVersion,
        })
        .from(documents)
        .leftJoin(
          documentSyncProgress,
          and(
            eq(documentSyncProgress.appKind, documents.appKind),
            eq(documentSyncProgress.localId, documents.localId),
          ),
        )
        .where(
          and(
            eq(documents.appKind, DOCUMENTS_APP_KIND),
            inArray(documents.documentId, documentIds),
          ),
        );
      for (const row of rows) {
        if (
          row.documentId !== null &&
          !cursorCovers(row, judge, advertised.get(row.documentId) ?? 0)
        ) {
          behind.add(row.documentId);
        }
      }
    }
    return [...behind].map((documentId) => ({
      documentId,
      updateCount: advertised.get(documentId) ?? 0,
    }));
  }

  /** Record, or renew, a request that each document be read. */
  async request(
    requests: ReadonlyArray<ListedDocumentUpdateCount>,
  ): Promise<void> {
    if (requests.length === 0) return;
    await ensureSqlTables(this.execSql, documentTables);
    const requestedAt = this.now().toISOString();
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        for (const batch of batches(requests)) {
          await db
            .insert(documentListingRevalidations)
            .values(
              batch.map(({ documentId, updateCount }) => ({
                advertisedUpdateCount: updateCount,
                documentId,
                requestedAt,
                revision: crypto.randomUUID(),
              })),
            )
            .onConflictDoUpdate({
              target: documentListingRevalidations.documentId,
              set: {
                // A listing read from a lagging replica never lowers the debt.
                advertisedUpdateCount: sql`max(${documentListingRevalidations.advertisedUpdateCount}, excluded.advertised_update_count)`,
                requestedAt: sql`excluded.requested_at`,
                revision: sql`excluded.revision`,
              },
            })
            .run();
        }
      },
    );
  }

  /** The request still owed to `documentId`, if any. */
  async find(documentId: string): Promise<DocumentListingRevalidation | null> {
    const [row] = await (await this.db())
      .select({
        advertisedUpdateCount:
          documentListingRevalidations.advertisedUpdateCount,
        documentId: documentListingRevalidations.documentId,
        revision: documentListingRevalidations.revision,
      })
      .from(documentListingRevalidations)
      .where(eq(documentListingRevalidations.documentId, documentId))
      .limit(1);
    return row ?? null;
  }

  /** Every document still owed a read, in document id order. */
  async listOwedDocumentIds(): Promise<ReadonlyArray<string>> {
    const rows = await (await this.db())
      .select({ documentId: documentListingRevalidations.documentId })
      .from(documentListingRevalidations)
      .orderBy(documentListingRevalidations.documentId);
    return rows.map(({ documentId }) => documentId);
  }

  /**
   * Settle the request a read observed. A newer request, from this tab or
   * another sharing the database, carries another revision and stays.
   */
  async settle(revalidation: DocumentListingRevalidation): Promise<void> {
    await ensureSqlTables(this.execSql, documentTables);
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await db
          .delete(documentListingRevalidations)
          .where(
            and(
              eq(
                documentListingRevalidations.documentId,
                revalidation.documentId,
              ),
              eq(documentListingRevalidations.revision, revalidation.revision),
            ),
          )
          .run();
      },
    );
  }
}
