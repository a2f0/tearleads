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
  const numberValue =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number" || typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isSafeInteger(numberValue) ||
    !Number.isFinite(numberValue) ||
    numberValue < 0
  ) {
    throw new Error(`Unexpected organization data usage value: ${label}`);
  }

  return numberValue;
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
    with document_usage as (
      select
        coalesce(sum(${documentUpdates.byteLength}), 0)::text as "documentByteLength",
        count(distinct ${documentUpdates.documentId})::text as "documentCount",
        count(${documentUpdates.id})::text as "documentUpdateCount"
      from ${documentUpdates}
      inner join ${documentContentWriteHeaders}
        on ${documentContentWriteHeaders.updateId} = ${documentUpdates.id}
      where ${documentContentWriteHeaders.organizationId} = ${input.organizationId}::uuid
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
