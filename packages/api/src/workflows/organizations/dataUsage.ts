import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  blobContentWriteHeaders,
  blobs,
  containerMetadataDocuments,
  documentContentWriteHeaders,
  documentUpdates,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
  type OrganizationDataUsageResponse,
  type OrganizationDocumentUsageCategory,
  type OrganizationDocumentUsageCategoryBreakdown,
} from "@tearleads/validators/response";
import { inArray, sql } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "./access";

// Fixed render order for the document breakdown. Built-in/system artifacts the
// app generates on the user's behalf (container metadata, per-member roster
// profiles, the org's public metadata document) come first; everything else is
// a genuine user document. Contacts and Trash contents are deliberately counted
// as user data — those live in per-user system containers but hold user content.
const DOCUMENT_USAGE_CATEGORY_ORDER: readonly OrganizationDocumentUsageCategory[] =
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES;

interface OrganizationBlobUsageRow {
  organizationId: string;
  blobByteLength: unknown;
  blobCount: unknown;
}

interface OrganizationDocumentCategoryRow {
  organizationId: string;
  byteLength: unknown;
  category: unknown;
  documentCount: unknown;
  documentUpdateCount: unknown;
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

function isOrganizationBlobUsageRow(
  value: unknown,
): value is OrganizationBlobUsageRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "organizationId" in value &&
    typeof value.organizationId === "string"
  );
}

function isOrganizationDocumentCategoryRow(
  value: unknown,
): value is OrganizationDocumentCategoryRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "organizationId" in value &&
    typeof value.organizationId === "string"
  );
}

function isDocumentUsageCategory(
  value: unknown,
): value is OrganizationDocumentUsageCategory {
  return (
    typeof value === "string" &&
    DOCUMENT_USAGE_CATEGORY_ORDER.some((category) => category === value)
  );
}

function sumUsageField(
  entries: readonly OrganizationDocumentUsageCategoryBreakdown[],
  field: "byteLength" | "documentCount" | "updateCount",
  label: string,
): number {
  const total = entries.reduce((sum, entry) => sum + BigInt(entry[field]), 0n);
  return toNonNegativeSafeInteger(total, label);
}

/** Read-only usage projection; callers enforce organization or root access. */
export async function loadOrganizationsDataUsage(
  executor: DatabaseSession,
  organizationIds: readonly string[],
): Promise<Map<string, OrganizationDataUsageResponse>> {
  if (organizationIds.length === 0) return new Map();
  // Classify each of the org's documents into exactly one category. The three
  // system categories are recognized by direct joins: container metadata
  // documents (one per container), per-member roster profile documents, and the
  // organization's own public profile document. Anything left over is a user
  // document. Categories partition the document set, so summing them reproduces
  // the org-wide totals.
  const categoryResult = await executor.execute(sql`
    with document_rows as (
      select
        ${documentContentWriteHeaders.organizationId} as "organizationId",
        ${documentUpdates.id} as "updateId",
        ${documentUpdates.documentId} as "documentId",
        ${documentUpdates.byteLength} as "byteLength"
      from ${documentUpdates}
      inner join ${documentContentWriteHeaders}
        on ${documentContentWriteHeaders.updateId} = ${documentUpdates.id}
      where ${inArray(documentContentWriteHeaders.organizationId, [...organizationIds])}
      group by
        ${documentContentWriteHeaders.organizationId},
        ${documentUpdates.id},
        ${documentUpdates.documentId},
        ${documentUpdates.byteLength}
    ),
    distinct_documents as (
      select distinct "organizationId", "documentId" from document_rows
    ),
    document_categories as (
      select
        distinct_documents."organizationId" as "organizationId",
        distinct_documents."documentId" as "documentId",
        case
          when ${containerMetadataDocuments.documentId} is not null
            then 'containerMetadata'
          when roster_profiles."profileDocumentId" is not null
            then 'rosterProfiles'
          when ${organizations.profileDocumentId} is not null
            then 'organizationMetadata'
          else 'user'
        end as "category"
      from distinct_documents
      left join ${containerMetadataDocuments}
        on ${containerMetadataDocuments.documentId} = distinct_documents."documentId"
      left join (
        select distinct ${organizationRosterEntries.organizationId} as "organizationId", ${organizationRosterEntries.profileDocumentId} as "profileDocumentId"
        from ${organizationRosterEntries}
        where ${inArray(organizationRosterEntries.organizationId, [...organizationIds])}
          and ${organizationRosterEntries.profileDocumentId} is not null
      ) as roster_profiles
        on roster_profiles."profileDocumentId" = distinct_documents."documentId"
        and roster_profiles."organizationId" = distinct_documents."organizationId"
      left join ${organizations}
        on ${organizations.id} = distinct_documents."organizationId"
        and ${organizations.profileDocumentId} = distinct_documents."documentId"
    )
    select
      document_rows."organizationId" as "organizationId",
      document_categories."category" as "category",
      coalesce(sum(document_rows."byteLength"), 0) as "byteLength",
      count(distinct document_rows."documentId") as "documentCount",
      count(document_rows."updateId") as "documentUpdateCount"
    from document_rows
    inner join document_categories
      on document_categories."documentId" = document_rows."documentId"
      and document_categories."organizationId" = document_rows."organizationId"
    group by document_rows."organizationId", document_categories."category"
  `);

  const blobResult = await executor.execute(sql`
    with blob_rows as (
      select distinct
        ${blobContentWriteHeaders.organizationId} as "organizationId",
        ${blobs.id} as "blobId",
        ${blobs.byteLength} as "byteLength"
      from ${blobs}
      inner join ${blobContentWriteHeaders}
        on ${blobContentWriteHeaders.blobId} = ${blobs.id}
      where ${inArray(blobContentWriteHeaders.organizationId, [...organizationIds])}
    )
    select
      "organizationId",
      coalesce(sum("byteLength"), 0) as "blobByteLength",
      count("blobId") as "blobCount"
    from blob_rows
    group by "organizationId"
  `);

  const categoryRows = categoryResult.rows.map((row) => {
    if (!isOrganizationDocumentCategoryRow(row))
      throw new Error("Invalid document usage row");
    return row;
  });
  const blobRows = blobResult.rows.map((row) => {
    if (!isOrganizationBlobUsageRow(row))
      throw new Error("Invalid blob usage row");
    return row;
  });
  return new Map(
    organizationIds.map((organizationId) => [
      organizationId,
      serializeUsage(
        organizationId,
        categoryRows.filter((row) => row.organizationId === organizationId),
        blobRows.find((row) => row.organizationId === organizationId),
      ),
    ]),
  );
}

function serializeUsage(
  organizationId: string,
  categoryRows: OrganizationDocumentCategoryRow[],
  blobRow: OrganizationBlobUsageRow | undefined,
): OrganizationDataUsageResponse {
  const usageByCategory = new Map<
    OrganizationDocumentUsageCategory,
    { byteLength: number; documentCount: number; updateCount: number }
  >();
  for (const row of categoryRows) {
    const category = row.category;
    if (!isDocumentUsageCategory(category)) {
      throw new Error(
        `Unexpected organization document usage category: ${String(category)}`,
      );
    }
    usageByCategory.set(category, {
      byteLength: toNonNegativeSafeInteger(
        row.byteLength,
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
    });
  }

  const breakdown: OrganizationDocumentUsageCategoryBreakdown[] =
    DOCUMENT_USAGE_CATEGORY_ORDER.map((category) => {
      const usage = usageByCategory.get(category) ?? {
        byteLength: 0,
        documentCount: 0,
        updateCount: 0,
      };
      return { category, ...usage };
    });

  const documentByteLength = sumUsageField(
    breakdown,
    "byteLength",
    "documentByteLength",
  );
  const documentCount = sumUsageField(
    breakdown,
    "documentCount",
    "documentCount",
  );
  const documentUpdateCount = sumUsageField(
    breakdown,
    "updateCount",
    "documentUpdateCount",
  );

  const blobByteLength = toNonNegativeSafeInteger(
    blobRow?.blobByteLength ?? 0,
    "blobByteLength",
  );

  return {
    organizationId,
    blobs: {
      blobCount: toNonNegativeSafeInteger(blobRow?.blobCount ?? 0, "blobCount"),
      byteLength: blobByteLength,
    },
    documents: {
      breakdown,
      byteLength: documentByteLength,
      documentCount,
      updateCount: documentUpdateCount,
    },
    totalByteLength: toNonNegativeSafeInteger(
      BigInt(documentByteLength) + BigInt(blobByteLength),
      "totalByteLength",
    ),
  };
}

export async function runGetOrganizationDataUsageWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationDataUsageResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });
    const usage = (await loadOrganizationsDataUsage(tx, [organizationId])).get(
      organizationId,
    );
    if (!usage) throw new Error("Missing organization data usage");
    return usage;
  });
}
