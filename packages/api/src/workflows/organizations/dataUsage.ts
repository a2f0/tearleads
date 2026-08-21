import type {
  ApiDatabase,
  DatabaseSession,
} from "@symcrypt/api-shared/postgres";
import {
  blobContentWriteHeaders,
  blobs,
  containerMetadataDocuments,
  documentContentWriteHeaders,
  documentUpdates,
  organizationRosterEntries,
  organizations,
} from "@symcrypt/api-shared/schema";
import {
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
  type OrganizationDataUsageResponse,
  type OrganizationDocumentUsageCategory,
  type OrganizationDocumentUsageCategoryBreakdown,
} from "@symcrypt/validators/response";
import { sql } from "drizzle-orm";
import { uuidValue } from "../../utils/sqlDialect";
import { requireDirectOrganizationAccess } from "./access";

// Fixed render order for the document breakdown. Built-in/system artifacts the
// app generates on the user's behalf (container metadata, per-member roster
// profiles, the org's public metadata document) come first; everything else is
// a genuine user document. Contacts and Trash contents are deliberately counted
// as user data — those live in per-user system containers but hold user content.
const DOCUMENT_USAGE_CATEGORY_ORDER: readonly OrganizationDocumentUsageCategory[] =
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES;

interface OrganizationBlobUsageRow {
  blobByteLength: unknown;
  blobCount: unknown;
}

interface OrganizationDocumentCategoryRow {
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
  return typeof value === "object" && value !== null;
}

function isOrganizationDocumentCategoryRow(
  value: unknown,
): value is OrganizationDocumentCategoryRow {
  return typeof value === "object" && value !== null;
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

  // Classify each of the org's documents into exactly one category. The three
  // system categories are recognized by direct joins: container metadata
  // documents (one per container), per-member roster profile documents, and the
  // organization's own public profile document. Anything left over is a user
  // document. Categories partition the document set, so summing them reproduces
  // the org-wide totals.
  const categoryResult = await input.executor.execute(sql`
    with document_rows as (
      select
        ${documentUpdates.id} as "updateId",
        ${documentUpdates.documentId} as "documentId",
        ${documentUpdates.byteLength} as "byteLength"
      from ${documentUpdates}
      inner join ${documentContentWriteHeaders}
        on ${documentContentWriteHeaders.updateId} = ${documentUpdates.id}
      where ${documentContentWriteHeaders.organizationId} = ${uuidValue(input.organizationId)}
      group by
        ${documentUpdates.id},
        ${documentUpdates.documentId},
        ${documentUpdates.byteLength}
    ),
    distinct_documents as (
      select distinct "documentId" from document_rows
    ),
    document_categories as (
      select
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
        select distinct ${organizationRosterEntries.profileDocumentId} as "profileDocumentId"
        from ${organizationRosterEntries}
        where ${organizationRosterEntries.organizationId} = ${uuidValue(input.organizationId)}
          and ${organizationRosterEntries.profileDocumentId} is not null
      ) as roster_profiles
        on roster_profiles."profileDocumentId" = distinct_documents."documentId"
      left join ${organizations}
        on ${organizations.id} = ${uuidValue(input.organizationId)}
        and ${organizations.profileDocumentId} = distinct_documents."documentId"
    )
    select
      document_categories."category" as "category",
      coalesce(sum(document_rows."byteLength"), 0) as "byteLength",
      count(distinct document_rows."documentId") as "documentCount",
      count(document_rows."updateId") as "documentUpdateCount"
    from document_rows
    inner join document_categories
      on document_categories."documentId" = document_rows."documentId"
    group by document_categories."category"
  `);

  const blobResult = await input.executor.execute(sql`
    with blob_rows as (
      select distinct
        ${blobs.id} as "blobId",
        ${blobs.byteLength} as "byteLength"
      from ${blobs}
      inner join ${blobContentWriteHeaders}
        on ${blobContentWriteHeaders.blobId} = ${blobs.id}
      where ${blobContentWriteHeaders.organizationId} = ${uuidValue(input.organizationId)}
    )
    select
      coalesce(sum("byteLength"), 0) as "blobByteLength",
      count("blobId") as "blobCount"
    from blob_rows
  `);

  const usageByCategory = new Map<
    OrganizationDocumentUsageCategory,
    { byteLength: number; documentCount: number; updateCount: number }
  >();
  for (const row of categoryResult.rows) {
    if (!isOrganizationDocumentCategoryRow(row)) {
      throw new Error("Missing organization data usage row");
    }
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

  const blobRow = blobResult.rows[0];
  if (!isOrganizationBlobUsageRow(blobRow)) {
    throw new Error("Missing organization data usage row");
  }
  const blobByteLength = toNonNegativeSafeInteger(
    blobRow.blobByteLength,
    "blobByteLength",
  );

  return {
    organizationId: input.organizationId,
    blobs: {
      blobCount: toNonNegativeSafeInteger(blobRow.blobCount, "blobCount"),
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
  return db.transaction((tx) =>
    loadOrganizationDataUsageInTransaction({
      executor: tx,
      organizationId,
      sessionUserId,
    }),
  );
}
