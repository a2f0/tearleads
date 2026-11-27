import { satisfiesVersionVector } from "@tearleads/loro";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import { documentListingRevalidations } from "../../sqlite/schema/documentListingRevalidationSchema";
import {
  documents,
  documentTables,
} from "../../sqlite/schema/documentRecordSchema";
import { documentSyncProgress } from "../../sqlite/schema/documentSyncVerdictSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

/** A record owed a remote read, what the read must reach, and its revision. */
export interface DocumentListingRevalidation {
  /** The epoch of the newest access head a listing showed. */
  readonly advertisedAccessEpoch: number;
  /** The most updates a listing counted; a read must cover at least these. */
  readonly advertisedUpdateCount: number;
  readonly documentId: string;
  /** The record that owes the read. */
  readonly localId: string;
  readonly revision: string;
}

/** A document as a container listing reported it. */
export interface ListedDocumentHead {
  /** The epoch of that head; a head move raises it. */
  readonly accessEpoch: number;
  /** The document's access manifest head. */
  readonly accessStateHash: string;
  readonly documentId: string;
  /** How many updates the server holds for the document. */
  readonly updateCount: number;
}

/** A read to owe: the record, its document, and what its pull must reach. */
export interface OwedDocumentRead {
  readonly accessEpoch: number;
  readonly documentId: string;
  readonly localId: string;
  readonly updateCount: number;
}

/** A record that still owes a read. */
export type OwedDocumentRecord = Pick<
  DocumentListingRevalidation,
  "documentId" | "localId"
>;

const ID_BATCH_SIZE = 400;

function batches<T>(values: readonly T[]): T[][] {
  return Array.from(
    { length: Math.ceil(values.length / ID_BATCH_SIZE) },
    (_, index) =>
      values.slice(index * ID_BATCH_SIZE, (index + 1) * ID_BATCH_SIZE),
  );
}

/** What a record holds that a listing's debt is judged against. */
interface HeldRecordState {
  readonly documentId: string | null;
  readonly frontier: string;
  readonly heldAccessEpoch: number | null;
  readonly heldAccessHead: string | null;
  readonly judge: string | null;
  readonly localId: string;
  readonly progressDocumentId: string | null;
  readonly throughUpdateCount: number | null;
  readonly throughUpdateId: string | null;
  readonly throughVersion: string | null;
}

/**
 * Whether a record's processed cursor covers `updateCount`: the running
 * `judge` reached it for the record's server document, the record's persisted
 * frontier still covers the version recorded with it, and its pull counted at
 * least that many updates.
 */
function cursorCovers(
  row: HeldRecordState,
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
 * The access manifest head a record's stored key bundle was issued under,
 * which is the head its next sync presents; null for a record that holds no
 * bundle.
 */
const heldAccessHead = sql<
  string | null
>`json_extract(CASE WHEN json_valid(${documents.contentKeyBundle}) THEN ${documents.contentKeyBundle} END, '$.linkSetManifestHash')`;

/**
 * The epoch of that head, from the manifest the record keeps beside its key
 * bundle; null when the record holds no bundle or keeps another manifest.
 */
const heldAccessEpoch = sql<number | null>`CASE
  WHEN json_valid(${documents.documentManifestBundle})
   AND json_extract(${documents.documentManifestBundle}, '$.manifestHash') = ${heldAccessHead}
  THEN json_extract(${documents.documentManifestBundle}, '$.manifest.epoch')
END`;

/** Whether a record has not read what the listing shows; see `listBehindListing`. */
function recordIsBehind(
  row: HeldRecordState,
  judge: string,
  head: ListedDocumentHead,
): boolean {
  return (
    (row.heldAccessHead !== null &&
      row.heldAccessHead !== head.accessStateHash) ||
    (head.updateCount > 0 && !cursorCovers(row, judge, head.updateCount))
  );
}

/**
 * Whether a record has read what a debt asks for: its cursor covers the
 * advertised count, and its key bundle carries the advertised head or a
 * later one. A document's heads are ordered by epoch, so a pull a replica
 * answered from before the head moved does not pay the debt.
 */
function recordPaysDebt(
  row: HeldRecordState,
  judge: string,
  debt: DocumentListingRevalidation,
): boolean {
  return (
    row.documentId === debt.documentId &&
    row.heldAccessEpoch !== null &&
    row.heldAccessEpoch >= debt.advertisedAccessEpoch &&
    (debt.advertisedUpdateCount === 0 ||
      cursorCovers(row, judge, debt.advertisedUpdateCount))
  );
}

/** The newest head each listed document was shown with, by document id. */
function newestListedHeads(
  listed: ReadonlyArray<ListedDocumentHead>,
): ReadonlyMap<string, ListedDocumentHead> {
  const advertised = new Map<string, ListedDocumentHead>();
  for (const document of listed) {
    const known = advertised.get(document.documentId);
    advertised.set(
      document.documentId,
      known === undefined
        ? document
        : {
            ...(document.accessEpoch > known.accessEpoch ? document : known),
            updateCount: Math.max(known.updateCount, document.updateCount),
          },
    );
  }
  return advertised;
}

const heldRecordSelection = {
  documentId: documents.documentId,
  frontier: documents.snapshotEndVersion,
  heldAccessEpoch,
  heldAccessHead,
  judge: documentSyncProgress.judge,
  localId: documents.localId,
  progressDocumentId: documentSyncProgress.documentId,
  throughUpdateCount: documentSyncProgress.throughUpdateCount,
  throughUpdateId: documentSyncProgress.throughUpdateId,
  throughVersion: documentSyncProgress.throughVersion,
};

const progressOfRecord = and(
  eq(documentSyncProgress.appKind, documents.appKind),
  eq(documentSyncProgress.localId, documents.localId),
);

/**
 * Reads owed to records of ordinary documents, bound to one executor and
 * clock. See `document_listing_revalidations` for what a row means.
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
   * The records of listed documents that the listing shows moved past what
   * the record last read, one entry per record. Run it before the listing is
   * applied: an apply that moves a record's access epoch drops the key
   * bundle the record held, and with it the head this compares.
   *
   * A record is behind when its processed cursor does not cover the count the
   * listing advertised. A cursor counts only when the running `judge` reached
   * it for this server document and the record's persisted frontier still
   * covers the version recorded with it, which are the rules for sending it;
   * a document with no update has nothing to cover. A record is also behind
   * when the key bundle it holds was issued under another access head than
   * the one listed: a link change or a rotation moves the head, and an open
   * store keeps the context of the head it last read. A record with no key
   * bundle has completed no pull, so no listing covers its store and it
   * probes when it loads; a document this device holds no record of is left
   * to its first open, which always pulls.
   */
  async listBehindListing(
    listed: ReadonlyArray<ListedDocumentHead>,
    judge: string,
  ): Promise<ReadonlyArray<OwedDocumentRead>> {
    const advertised = newestListedHeads(listed);
    if (advertised.size === 0) return [];
    const db = await this.db();
    const behind: OwedDocumentRead[] = [];
    for (const documentIds of batches([...advertised.keys()])) {
      const rows = await db
        .select(heldRecordSelection)
        .from(documents)
        .leftJoin(documentSyncProgress, progressOfRecord)
        .where(
          and(
            eq(documents.appKind, DOCUMENTS_APP_KIND),
            inArray(documents.documentId, documentIds),
          ),
        );
      for (const row of rows) {
        const head =
          row.documentId === null ? undefined : advertised.get(row.documentId);
        if (head && recordIsBehind(row, judge, head)) {
          behind.push({
            accessEpoch: head.accessEpoch,
            documentId: head.documentId,
            localId: row.localId,
            updateCount: head.updateCount,
          });
        }
      }
    }
    return behind;
  }

  /** Record, or renew, a request that each record read its document. */
  async request(requests: ReadonlyArray<OwedDocumentRead>): Promise<void> {
    if (requests.length === 0) return;
    await ensureSqlTables(this.execSql, documentTables);
    const requestedAt = this.now().toISOString();
    // A listing read from a lagging replica never lowers a debt of the same
    // document; a record that now names another document owes that one.
    const sameDocument = sql`${documentListingRevalidations.documentId} = excluded.document_id`;
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        for (const batch of batches(requests)) {
          await db
            .insert(documentListingRevalidations)
            .values(
              batch.map((owed) => ({
                advertisedAccessEpoch: owed.accessEpoch,
                advertisedUpdateCount: owed.updateCount,
                documentId: owed.documentId,
                localId: owed.localId,
                requestedAt,
                revision: crypto.randomUUID(),
              })),
            )
            .onConflictDoUpdate({
              target: documentListingRevalidations.localId,
              set: {
                advertisedAccessEpoch: sql`CASE WHEN ${sameDocument} THEN max(${documentListingRevalidations.advertisedAccessEpoch}, excluded.advertised_access_epoch) ELSE excluded.advertised_access_epoch END`,
                advertisedUpdateCount: sql`CASE WHEN ${sameDocument} THEN max(${documentListingRevalidations.advertisedUpdateCount}, excluded.advertised_update_count) ELSE excluded.advertised_update_count END`,
                documentId: sql`excluded.document_id`,
                requestedAt: sql`excluded.requested_at`,
                revision: sql`excluded.revision`,
              },
            })
            .run();
        }
      },
    );
  }

  /** The request a record still owes for `documentId`, if any. */
  async find(
    record: OwedDocumentRecord,
  ): Promise<DocumentListingRevalidation | null> {
    const [row] = await (await this.db())
      .select({
        advertisedAccessEpoch:
          documentListingRevalidations.advertisedAccessEpoch,
        advertisedUpdateCount:
          documentListingRevalidations.advertisedUpdateCount,
        documentId: documentListingRevalidations.documentId,
        localId: documentListingRevalidations.localId,
        revision: documentListingRevalidations.revision,
      })
      .from(documentListingRevalidations)
      .where(
        and(
          eq(documentListingRevalidations.localId, record.localId),
          eq(documentListingRevalidations.documentId, record.documentId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Every record still owed a read, in document and record order. */
  async listOwed(): Promise<ReadonlyArray<OwedDocumentRecord>> {
    return (await this.db())
      .select({
        documentId: documentListingRevalidations.documentId,
        localId: documentListingRevalidations.localId,
      })
      .from(documentListingRevalidations)
      .orderBy(
        documentListingRevalidations.documentId,
        documentListingRevalidations.localId,
      );
  }

  /**
   * Forget the reads owed by records that no longer hold their document: a
   * purge or a revoked link removed the record, or it was pointed at another
   * server document, and nothing will ever pay them.
   */
  async forgetUnheld(): Promise<void> {
    await ensureSqlTables(this.execSql, documentTables);
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await db
          .delete(documentListingRevalidations)
          .where(
            notExists(
              db
                .select({ localId: documents.localId })
                .from(documents)
                .where(
                  and(
                    eq(documents.appKind, DOCUMENTS_APP_KIND),
                    eq(documents.localId, documentListingRevalidations.localId),
                    eq(
                      documents.documentId,
                      documentListingRevalidations.documentId,
                    ),
                  ),
                ),
            ),
          )
          .run();
      },
    );
  }

  /**
   * Settle the request a read observed, if the record that owes it now pays
   * it (`recordPaysDebt`), as its record and cursor stand on disk. Returns
   * whether it was paid. A newer request, from this tab or another sharing
   * the database, carries another revision and stays.
   */
  async settle(
    revalidation: DocumentListingRevalidation,
    judge: string,
  ): Promise<boolean> {
    await ensureSqlTables(this.execSql, documentTables);
    return getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        const [record] = await db
          .select(heldRecordSelection)
          .from(documents)
          .leftJoin(documentSyncProgress, progressOfRecord)
          .where(
            and(
              eq(documents.appKind, DOCUMENTS_APP_KIND),
              eq(documents.localId, revalidation.localId),
            ),
          )
          .limit(1);
        if (!record || !recordPaysDebt(record, judge, revalidation)) {
          return false;
        }
        await db
          .delete(documentListingRevalidations)
          .where(
            and(
              eq(documentListingRevalidations.localId, revalidation.localId),
              eq(documentListingRevalidations.revision, revalidation.revision),
            ),
          )
          .run();
        return true;
      },
    );
  }
}
