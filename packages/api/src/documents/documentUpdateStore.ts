import { Buffer } from "node:buffer";
import {
  type ApiDatabaseKind,
  type DatabaseSession,
  getDefaultApiDatabaseKind,
} from "@tearleads/api-shared/postgres";
import {
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { decodeVersionVector } from "@tearleads/loro";
import type { DocumentUpdateRecord } from "@tearleads/loro/server";
import { parseWalLsn } from "@tearleads/validators/util";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  isSqliteApiDatabase,
  textExpression,
  uuidValue,
} from "../utils/sqlDialect";
import { readCurrentCommitLsn } from "./commitLsn";

interface SqlNamedColumn {
  name: string;
}

interface MissingDocumentUpdateCandidate {
  id: string;
  sequence: number;
}

interface MissingDocumentUpdatePage {
  readonly hasMore: boolean;
  readonly lastUpdateId: string | null;
  readonly lastSequence: number;
  readonly updates: readonly DocumentUpdateRecord[];
}

export interface DocumentUpdateCursorPosition {
  readonly id: string;
  readonly sequence: number;
}

interface ClientFrontierRow {
  counter: number;
  peerId: string;
}

export class DocumentUpdateReadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 503,
  ) {
    super(message);
    this.name = "DocumentUpdateReadError";
  }
}

function aliasedColumn(alias: string, column: SqlNamedColumn) {
  return sql.raw(`${alias}.${column.name}`);
}

function isMissingDocumentUpdateCandidate(
  value: unknown,
): value is MissingDocumentUpdateCandidate {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const id = Reflect.get(value, "id");
  const sequence = Reflect.get(value, "sequence");

  return (
    typeof id === "string" &&
    typeof sequence === "number" &&
    Number.isSafeInteger(sequence) &&
    sequence > 0
  );
}

function buildClientFrontierRows(
  localVersionVector: string | null,
): ClientFrontierRow[] {
  const rows: ClientFrontierRow[] = [];

  try {
    for (const [peerId, counter] of decodeVersionVector(localVersionVector)
      .toJSON()
      .entries()) {
      rows.push({ counter, peerId: String(peerId) });
    }
  } catch {
    throw new DocumentUpdateReadError("Invalid local version vector", 400);
  }

  return rows.sort((left, right) => left.peerId.localeCompare(right.peerId));
}

function buildClientFrontierJson(localVersionVector: string | null): string {
  return JSON.stringify(
    buildClientFrontierRows(localVersionVector).map((row) => ({
      counter: row.counter,
      peer_id: row.peerId,
    })),
  );
}

function buildFrontierRecordset(clientFrontierJson: string) {
  if (isSqliteApiDatabase()) {
    return {
      counter: sql`json_extract(frontier.value, '$.counter')`,
      peerId: sql`json_extract(frontier.value, '$.peer_id')`,
      recordset: sql`json_each(${clientFrontierJson}) as frontier`,
    };
  }

  return {
    counter: sql`frontier.counter`,
    peerId: sql`frontier.peer_id`,
    recordset: sql`jsonb_to_recordset(${clientFrontierJson}::jsonb) as frontier(peer_id text, counter integer)`,
  };
}

export async function assertMinLsnSatisfied(
  executor: DatabaseSession,
  minLsn: string | undefined,
  databaseKind: ApiDatabaseKind = getDefaultApiDatabaseKind(),
): Promise<void> {
  if (!minLsn) {
    return;
  }
  // Turso is configured as a remote primary only. With no read replica in the
  // request path, every successful read has already reached the current store.
  if (databaseKind === "turso") {
    return;
  }

  const currentCommitLsn = await readCurrentCommitLsn(executor);
  if (parseWalLsn(currentCommitLsn) < parseWalLsn(minLsn)) {
    throw new DocumentUpdateReadError(
      "Requested minimum commit LSN has not been reached",
      503,
    );
  }
}

async function listMissingDocumentUpdateCandidates(
  executor: DatabaseSession,
  input: {
    readonly afterSequence?: number | undefined;
    readonly documentId: string;
    readonly limit?: number | undefined;
    readonly localVersionVector: string | null;
    readonly upperBoundSequence?: number | undefined;
  },
): Promise<MissingDocumentUpdateCandidate[]> {
  const updateId = aliasedColumn("u", documentUpdates.id);
  const updateDocumentId = aliasedColumn("u", documentUpdates.documentId);
  const updateSequence = aliasedColumn("u", documentUpdates.sequence);
  const spanDocumentId = aliasedColumn("s", documentUpdateSpans.documentId);
  const spanUpdateId = aliasedColumn("s", documentUpdateSpans.updateId);
  const spanPeerId = aliasedColumn("s", documentUpdateSpans.peerId);
  const spanEndCounter = aliasedColumn("s", documentUpdateSpans.endCounter);
  const clientFrontierJson = buildClientFrontierJson(input.localVersionVector);
  const frontier = buildFrontierRecordset(clientFrontierJson);
  const lowerBound =
    input.afterSequence === undefined
      ? sql``
      : sql`and ${updateSequence} > ${input.afterSequence}`;
  const upperBound =
    input.upperBoundSequence === undefined
      ? sql``
      : sql`and ${updateSequence} <= ${input.upperBoundSequence}`;
  const limit = input.limit === undefined ? sql`` : sql`limit ${input.limit}`;
  const result = await executor.execute(sql`
    select
      ${updateSequence} as "sequence",
      ${textExpression(updateId)} as "id"
    from ${documentUpdates} u
    where ${updateDocumentId} = ${uuidValue(input.documentId)}
      ${lowerBound}
      ${upperBound}
      and (
        not exists (
          select 1
          from ${documentUpdateSpans} s
          where ${spanDocumentId} = ${uuidValue(input.documentId)}
            and ${spanUpdateId} = ${updateId}
        )
        or exists (
          select 1
          from ${documentUpdateSpans} s
          left join ${frontier.recordset}
            on ${frontier.peerId} = ${spanPeerId}
          where ${spanDocumentId} = ${uuidValue(input.documentId)}
            and ${spanUpdateId} = ${updateId}
            and coalesce(${frontier.counter}, 0) < ${spanEndCounter}
        )
      )
    order by ${updateSequence} asc
    ${limit}
  `);
  const candidates: MissingDocumentUpdateCandidate[] = [];

  for (const row of result.rows) {
    if (!isMissingDocumentUpdateCandidate(row)) {
      throw new Error(
        "Unexpected row shape from missing document update candidates query",
      );
    }
    candidates.push(row);
  }
  return candidates;
}

async function loadDocumentUpdatesByCandidate(
  executor: DatabaseSession,
  candidates: readonly MissingDocumentUpdateCandidate[],
): Promise<DocumentUpdateRecord[]> {
  if (candidates.length === 0) {
    return [];
  }
  const rows = await executor
    .select()
    .from(documentUpdates)
    .where(
      inArray(
        documentUpdates.id,
        candidates.map(({ id }) => id),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return candidates.map((candidate) => {
    const row = byId.get(candidate.id);
    if (!row || row.sequence !== candidate.sequence) {
      throw new DocumentUpdateReadError(
        "Document update changed while loading page; retry",
        409,
      );
    }
    return row;
  });
}

export async function readDocumentUpdateUpperBound(
  executor: DatabaseSession,
  documentId: string,
): Promise<DocumentUpdateCursorPosition | null> {
  const [row] = await executor
    .select({ id: documentUpdates.id, sequence: documentUpdates.sequence })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId))
    .orderBy(desc(documentUpdates.sequence))
    .limit(1);
  if (!row) return null;
  if (!Number.isSafeInteger(row.sequence) || row.sequence < 1) {
    throw new Error("Invalid document update sequence upper bound");
  }
  return row;
}

export async function readDocumentUpdateSequenceUpperBound(
  executor: DatabaseSession,
  documentId: string,
): Promise<number> {
  return (
    (await readDocumentUpdateUpperBound(executor, documentId))?.sequence ?? 0
  );
}

export async function resolveDocumentUpdateCursorBounds(
  executor: DatabaseSession,
  input: {
    readonly afterUpdateId: string;
    readonly documentId: string;
    readonly upperBoundUpdateId: string;
  },
): Promise<{
  readonly afterSequence: number;
  readonly upperBoundSequence: number;
}> {
  const ids = [...new Set([input.afterUpdateId, input.upperBoundUpdateId])];
  const rows = await executor
    .select({ id: documentUpdates.id, sequence: documentUpdates.sequence })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, input.documentId),
        inArray(documentUpdates.id, ids),
      ),
    );
  const sequenceById = new Map(rows.map((row) => [row.id, row.sequence]));
  const afterSequence = sequenceById.get(input.afterUpdateId);
  const upperBoundSequence = sequenceById.get(input.upperBoundUpdateId);
  if (
    afterSequence === undefined ||
    upperBoundSequence === undefined ||
    afterSequence > upperBoundSequence
  ) {
    throw new DocumentUpdateReadError("Document pull cursor is invalid", 400);
  }
  return { afterSequence, upperBoundSequence };
}

export async function listMissingDocumentUpdates(
  executor: DatabaseSession,
  input: {
    documentId: string;
    localVersionVector: string | null;
    minLsn?: string | undefined;
  },
): Promise<DocumentUpdateRecord[]> {
  await assertMinLsnSatisfied(executor, input.minLsn);
  const candidates = await listMissingDocumentUpdateCandidates(executor, input);
  return loadDocumentUpdatesByCandidate(executor, candidates);
}

export async function hasMissingDocumentUpdatesThroughSequence(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly localVersionVector: string | null;
    readonly upperBoundSequence: number;
  },
): Promise<boolean> {
  const candidates = await listMissingDocumentUpdateCandidates(executor, {
    documentId: input.documentId,
    limit: 1,
    localVersionVector: input.localVersionVector,
    upperBoundSequence: input.upperBoundSequence,
  });
  return candidates.length > 0;
}

export async function listMissingDocumentUpdatePage(
  executor: DatabaseSession,
  input: {
    readonly afterSequence: number;
    readonly documentId: string;
    readonly localVersionVector: string | null;
    readonly maxSerializedBytes: number;
    readonly maxUpdates: number;
    readonly minLsn?: string | undefined;
    readonly upperBoundSequence: number;
  },
): Promise<MissingDocumentUpdatePage> {
  await assertMinLsnSatisfied(executor, input.minLsn);
  const candidates = await listMissingDocumentUpdateCandidates(executor, {
    afterSequence: input.afterSequence,
    documentId: input.documentId,
    limit: input.maxUpdates + 1,
    localVersionVector: input.localVersionVector,
    upperBoundSequence: input.upperBoundSequence,
  });
  const selected: DocumentUpdateRecord[] = [];
  let selectedBytes = 2; // JSON array brackets.
  for (const candidate of candidates.slice(0, input.maxUpdates)) {
    // Load one row at a time before retaining it. Candidate byte_length only
    // describes ciphertext; selecting all 64 candidates from that value first
    // can materialize an unbounded aggregate of version vectors, hashes, and
    // other response metadata before the later wire-size trim runs.
    const [update] = await loadDocumentUpdatesByCandidate(executor, [
      candidate,
    ]);
    if (!update) {
      throw new DocumentUpdateReadError(
        "Document update changed while loading page; retry",
        409,
      );
    }
    const updateBytes = Buffer.byteLength(JSON.stringify(update), "utf8");
    const addedBytes = updateBytes + (selected.length === 0 ? 0 : 1);
    if (selectedBytes + addedBytes > input.maxSerializedBytes) {
      break;
    }
    selected.push(update);
    selectedBytes += addedBytes;
  }
  if (candidates.length > 0 && selected.length === 0) {
    throw new DocumentUpdateReadError(
      "Document update exceeds the pull page byte ceiling",
      409,
    );
  }

  return {
    hasMore: selected.length < candidates.length,
    lastUpdateId: selected.at(-1)?.id ?? null,
    lastSequence: selected.at(-1)?.sequence ?? input.afterSequence,
    updates: selected,
  };
}
