import {
  type ApiDatabaseKind,
  type DatabaseSession,
  getDefaultApiDatabaseKind,
} from "@symcrypt/api-shared/postgres";
import {
  documentUpdateSpans,
  documentUpdates,
} from "@symcrypt/api-shared/schema";
import { decodeVersionVector } from "@symcrypt/loro";
import type { DocumentUpdateRecord } from "@symcrypt/loro/server";
import { parseWalLsn } from "@symcrypt/validators/util";
import { sql } from "drizzle-orm";
import {
  isSqliteApiDatabase,
  readDateValue,
  textExpression,
  uuidValue,
} from "../utils/sqlDialect";
import { readCurrentCommitLsn } from "./commitLsn";

interface SqlNamedColumn {
  name: string;
}

interface MissingDocumentUpdateRow {
  accessEpoch: number;
  authorFingerprint: string;
  byteLength: number;
  createdAt: Date | number | string;
  documentId: string;
  encryptedData: string;
  id: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  sequence: number;
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

function isMissingDocumentUpdateRow(
  value: unknown,
): value is MissingDocumentUpdateRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const accessEpoch = Reflect.get(value, "accessEpoch");
  const authorFingerprint = Reflect.get(value, "authorFingerprint");
  const byteLength = Reflect.get(value, "byteLength");
  const createdAt = Reflect.get(value, "createdAt");
  const documentId = Reflect.get(value, "documentId");
  const encryptedData = Reflect.get(value, "encryptedData");
  const id = Reflect.get(value, "id");
  const partialEndVersionVector = Reflect.get(value, "partialEndVersionVector");
  const partialStartVersionVector = Reflect.get(
    value,
    "partialStartVersionVector",
  );
  const plaintextHash = Reflect.get(value, "plaintextHash");
  const sequence = Reflect.get(value, "sequence");

  return (
    typeof accessEpoch === "number" &&
    Number.isInteger(accessEpoch) &&
    typeof authorFingerprint === "string" &&
    typeof byteLength === "number" &&
    Number.isInteger(byteLength) &&
    (createdAt instanceof Date ||
      typeof createdAt === "number" ||
      typeof createdAt === "string") &&
    typeof documentId === "string" &&
    typeof encryptedData === "string" &&
    typeof id === "string" &&
    typeof partialEndVersionVector === "string" &&
    typeof partialStartVersionVector === "string" &&
    typeof plaintextHash === "string" &&
    typeof sequence === "number" &&
    Number.isInteger(sequence)
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

export async function listMissingDocumentUpdates(
  executor: DatabaseSession,
  input: {
    documentId: string;
    localVersionVector: string | null;
    minLsn?: string | undefined;
  },
): Promise<DocumentUpdateRecord[]> {
  await assertMinLsnSatisfied(executor, input.minLsn);

  const updateId = aliasedColumn("u", documentUpdates.id);
  const updateDocumentId = aliasedColumn("u", documentUpdates.documentId);
  const updateSequence = aliasedColumn("u", documentUpdates.sequence);
  const updateAccessEpoch = aliasedColumn("u", documentUpdates.accessEpoch);
  const updateAuthorFingerprint = aliasedColumn(
    "u",
    documentUpdates.authorFingerprint,
  );
  const updateEncryptedData = aliasedColumn("u", documentUpdates.encryptedData);
  const updateByteLength = aliasedColumn("u", documentUpdates.byteLength);
  const updatePartialStartVersionVector = aliasedColumn(
    "u",
    documentUpdates.partialStartVersionVector,
  );
  const updatePartialEndVersionVector = aliasedColumn(
    "u",
    documentUpdates.partialEndVersionVector,
  );
  const updatePlaintextHash = aliasedColumn("u", documentUpdates.plaintextHash);
  const updateCreatedAt = aliasedColumn("u", documentUpdates.createdAt);
  const spanDocumentId = aliasedColumn("s", documentUpdateSpans.documentId);
  const spanUpdateId = aliasedColumn("s", documentUpdateSpans.updateId);
  const spanPeerId = aliasedColumn("s", documentUpdateSpans.peerId);
  const spanEndCounter = aliasedColumn("s", documentUpdateSpans.endCounter);
  const clientFrontierJson = buildClientFrontierJson(input.localVersionVector);
  const frontier = buildFrontierRecordset(clientFrontierJson);
  const result = await executor.execute(sql`
    select
      ${updateSequence} as "sequence",
      ${textExpression(updateId)} as "id",
      ${textExpression(updateDocumentId)} as "documentId",
      ${updateAccessEpoch} as "accessEpoch",
      ${updateAuthorFingerprint} as "authorFingerprint",
      ${updateEncryptedData} as "encryptedData",
      ${updateByteLength} as "byteLength",
      ${updatePartialStartVersionVector} as "partialStartVersionVector",
      ${updatePartialEndVersionVector} as "partialEndVersionVector",
      ${updatePlaintextHash} as "plaintextHash",
      ${updateCreatedAt} as "createdAt"
    from ${documentUpdates} u
    where ${updateDocumentId} = ${uuidValue(input.documentId)}
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
  `);
  const missingUpdates: DocumentUpdateRecord[] = [];

  for (const row of result.rows) {
    if (!isMissingDocumentUpdateRow(row)) {
      throw new Error(
        "Unexpected row shape from missing document updates query",
      );
    }

    const createdAt = readDateValue(
      row.createdAt,
      "createdAt from missing document updates query",
    );

    missingUpdates.push({
      accessEpoch: row.accessEpoch,
      authorFingerprint: row.authorFingerprint,
      byteLength: row.byteLength,
      createdAt,
      documentId: row.documentId,
      encryptedData: row.encryptedData,
      id: row.id,
      partialEndVersionVector: row.partialEndVersionVector,
      partialStartVersionVector: row.partialStartVersionVector,
      plaintextHash: row.plaintextHash,
      sequence: row.sequence,
    });
  }

  return missingUpdates;
}
