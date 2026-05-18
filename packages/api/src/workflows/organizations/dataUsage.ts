import type { OrganizationDataUsageResponse } from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import type { ApiDatabase, DatabaseSession } from "../../adapters/postgres";
import {
  blobContentWriteHeaders,
  blobs,
  documentContentWriteHeaders,
  documentUpdates,
} from "../../schema";
import { requireDirectOrganizationAccess } from "./access";

interface OrganizationDataUsageRow {
  blobByteLength: unknown;
  blobCount: unknown;
  documentByteLength: unknown;
  documentCount: unknown;
  documentUpdateCount: unknown;
  totalByteLength: unknown;
}

function toNonNegativeSafeInteger(value: unknown, label: string): number {
  let bigintValue: bigint;

  if (typeof value === "bigint") {
    bigintValue = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    bigintValue = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    bigintValue = BigInt(value.trim());
  } else {
    throw new Error(`Unexpected organization data usage value: ${label}`);
  }

  if (bigintValue < 0n || bigintValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Unexpected organization data usage value: ${label}`);
  }

  return Number(bigintValue);
}

function isOrganizationDataUsageRow(
  value: unknown,
): value is OrganizationDataUsageRow {
  return typeof value === "object" && value !== null;
}

async function loadOrganizationDataUsageInTransaction(input: {
  executor: DatabaseSession;
  organizationId: string;
  sessionUserId: string;
}): Promise<OrganizationDataUsageResponse> {
  await requireDirectOrganizationAccess({
    executor: input.executor,
    organizationId: input.organizationId,
    userId: input.sessionUserId,
  });

  const result = await input.executor.execute(sql`
    with document_rows as (
      select
        ${documentUpdates.id} as "updateId",
        ${documentUpdates.documentId} as "documentId",
        ${documentUpdates.byteLength} as "byteLength"
      from ${documentUpdates}
      inner join ${documentContentWriteHeaders}
        on ${documentContentWriteHeaders.updateId} = ${documentUpdates.id}
      where ${documentContentWriteHeaders.organizationId} = ${input.organizationId}::uuid
      group by
        ${documentUpdates.id},
        ${documentUpdates.documentId},
        ${documentUpdates.byteLength}
    ),
    document_usage as (
      select
        coalesce(sum("byteLength"), 0)::text as "documentByteLength",
        count(distinct "documentId")::text as "documentCount",
        count("updateId")::text as "documentUpdateCount"
      from document_rows
    ),
    blob_rows as (
      select distinct
        ${blobs.id} as "blobId",
        ${blobs.byteLength} as "byteLength"
      from ${blobs}
      inner join ${blobContentWriteHeaders}
        on ${blobContentWriteHeaders.blobId} = ${blobs.id}
      where ${blobContentWriteHeaders.organizationId} = ${input.organizationId}::uuid
    ),
    blob_usage as (
      select
        coalesce(sum("byteLength"), 0)::text as "blobByteLength",
        count("blobId")::text as "blobCount"
      from blob_rows
    )
    select
      document_usage."documentByteLength",
      document_usage."documentCount",
      document_usage."documentUpdateCount",
      blob_usage."blobByteLength",
      blob_usage."blobCount",
      (
        document_usage."documentByteLength"::bigint +
        blob_usage."blobByteLength"::bigint
      )::text as "totalByteLength"
    from document_usage, blob_usage
  `);
  const row = result.rows[0];
  if (!isOrganizationDataUsageRow(row)) {
    throw new Error("Missing organization data usage row");
  }

  return {
    organizationId: input.organizationId,
    blobs: {
      blobCount: toNonNegativeSafeInteger(row.blobCount, "blobCount"),
      byteLength: toNonNegativeSafeInteger(
        row.blobByteLength,
        "blobByteLength",
      ),
    },
    documents: {
      byteLength: toNonNegativeSafeInteger(
        row.documentByteLength,
        "documentByteLength",
      ),
      documentCount: toNonNegativeSafeInteger(
        row.documentCount,
        "documentCount",
      ),
      updateCount: toNonNegativeSafeInteger(
        row.documentUpdateCount,
        "documentUpdateCount",
      ),
    },
    totalByteLength: toNonNegativeSafeInteger(
      row.totalByteLength,
      "totalByteLength",
    ),
  };
}

export async function runGetOrganizationDataUsageWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationDataUsageResponse> {
  return db.transaction((tx) =>
    loadOrganizationDataUsageInTransaction({
      executor: tx,
      organizationId,
      sessionUserId,
    }),
  );
}
