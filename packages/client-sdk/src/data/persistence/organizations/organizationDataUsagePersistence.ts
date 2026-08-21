import {
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
  type OrganizationDataUsageResponse,
  OrganizationDataUsageResponseSchema,
  type OrganizationDocumentUsageCategory,
  type OrganizationDocumentUsageCategoryBreakdown,
} from "@symcrypt/validators/response";
import { and, eq } from "drizzle-orm";
import {
  ORGANIZATION_DATA_USAGE_PROJECTION_VERSION,
  organizationDataUsageCategories,
  organizationDataUsageSnapshots,
  organizationDataUsageTables,
} from "../../sqlite/organizationDataUsageSchema";
import { organizationReadModelTables } from "../../sqlite/organizationReadModelTableRegistry";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../sqlite/sqlTableSchema";
import { clearOrganizationPresentationDenialInTransaction } from "./organizationPresentationDenialPersistence";

type StoredCategory = typeof organizationDataUsageCategories.$inferSelect;
type StoredSnapshot = typeof organizationDataUsageSnapshots.$inferSelect;

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isDocumentUsageCategory(
  value: string,
): value is OrganizationDocumentUsageCategory {
  return ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.some(
    (category) => category === value,
  );
}

function isIsoTimestamp(value: string): boolean {
  try {
    return value.length > 0 && new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function requireScope(organizationId: string, requesterUserId?: string): void {
  if (
    organizationId.length === 0 ||
    (requesterUserId !== undefined && requesterUserId.length === 0)
  ) {
    throw new Error("Organization data usage scope is invalid");
  }
}

function parseResponse(
  response: OrganizationDataUsageResponse,
): OrganizationDataUsageResponse {
  const parsed = OrganizationDataUsageResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("Organization data usage response is invalid");
  }
  return parsed.data;
}

export async function purgeOrganizationDataUsageProjectionInTransaction(input: {
  readonly organizationId: string;
  readonly requesterUserId?: string | undefined;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  requireScope(input.organizationId, input.requesterUserId);
  const condition = input.requesterUserId
    ? and(
        eq(
          organizationDataUsageCategories.organizationId,
          input.organizationId,
        ),
        eq(
          organizationDataUsageCategories.requesterUserId,
          input.requesterUserId,
        ),
      )
    : eq(organizationDataUsageCategories.organizationId, input.organizationId);
  await input.tx.delete(organizationDataUsageCategories).where(condition).run();

  const snapshotCondition = input.requesterUserId
    ? and(
        eq(organizationDataUsageSnapshots.organizationId, input.organizationId),
        eq(
          organizationDataUsageSnapshots.requesterUserId,
          input.requesterUserId,
        ),
      )
    : eq(organizationDataUsageSnapshots.organizationId, input.organizationId);
  await input.tx
    .delete(organizationDataUsageSnapshots)
    .where(snapshotCondition)
    .run();
}

function isStoredSnapshotValid(
  snapshot: StoredSnapshot,
  organizationId: string,
  requesterUserId: string,
): boolean {
  return (
    snapshot.organizationId === organizationId &&
    snapshot.requesterUserId === requesterUserId &&
    snapshot.projectionVersion === ORGANIZATION_DATA_USAGE_PROJECTION_VERSION &&
    isNonNegativeSafeInteger(snapshot.blobCount) &&
    isNonNegativeSafeInteger(snapshot.blobByteLength) &&
    isNonNegativeSafeInteger(snapshot.documentByteLength) &&
    isNonNegativeSafeInteger(snapshot.documentCount) &&
    isNonNegativeSafeInteger(snapshot.documentUpdateCount) &&
    isNonNegativeSafeInteger(snapshot.totalByteLength) &&
    isIsoTimestamp(snapshot.refreshedAt)
  );
}

function storedResponse(
  snapshot: StoredSnapshot,
  categories: readonly StoredCategory[],
): OrganizationDataUsageResponse | null {
  if (categories.length !== ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.length) {
    return null;
  }
  const byCategory = new Map<
    OrganizationDocumentUsageCategory,
    OrganizationDocumentUsageCategoryBreakdown
  >();
  for (const row of categories) {
    const category = row.category;
    if (
      row.organizationId !== snapshot.organizationId ||
      row.requesterUserId !== snapshot.requesterUserId ||
      !isDocumentUsageCategory(category) ||
      byCategory.has(category) ||
      !isNonNegativeSafeInteger(row.byteLength) ||
      !isNonNegativeSafeInteger(row.documentCount) ||
      !isNonNegativeSafeInteger(row.updateCount)
    ) {
      return null;
    }
    byCategory.set(category, {
      byteLength: row.byteLength,
      category,
      documentCount: row.documentCount,
      updateCount: row.updateCount,
    });
  }
  const breakdown = ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.flatMap(
    (category) => {
      const entry = byCategory.get(category);
      return entry ? [entry] : [];
    },
  );
  if (breakdown.length !== ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.length) {
    return null;
  }

  const response: OrganizationDataUsageResponse = {
    organizationId: snapshot.organizationId,
    blobs: {
      blobCount: snapshot.blobCount,
      byteLength: snapshot.blobByteLength,
    },
    documents: {
      breakdown,
      byteLength: snapshot.documentByteLength,
      documentCount: snapshot.documentCount,
      updateCount: snapshot.documentUpdateCount,
    },
    totalByteLength: snapshot.totalByteLength,
  };
  const parsed = OrganizationDataUsageResponseSchema.safeParse(response);
  return parsed.success ? parsed.data : null;
}

export async function loadOrganizationDataUsageProjection(
  execSql: ExecSql,
  organizationId: string,
  requesterUserId: string,
): Promise<OrganizationDataUsageResponse | null> {
  requireScope(organizationId, requesterUserId);
  await ensureSqlTables(execSql, organizationDataUsageTables);
  return getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    const scope = and(
      eq(organizationDataUsageSnapshots.organizationId, organizationId),
      eq(organizationDataUsageSnapshots.requesterUserId, requesterUserId),
    );
    const [snapshot] = await tx
      .select()
      .from(organizationDataUsageSnapshots)
      .where(scope)
      .limit(1);
    const categories = await tx
      .select()
      .from(organizationDataUsageCategories)
      .where(
        and(
          eq(organizationDataUsageCategories.organizationId, organizationId),
          eq(organizationDataUsageCategories.requesterUserId, requesterUserId),
        ),
      );
    if (!snapshot) {
      if (categories.length > 0) {
        await purgeOrganizationDataUsageProjectionInTransaction({
          organizationId,
          requesterUserId,
          tx,
        });
      }
      return null;
    }
    const response = isStoredSnapshotValid(
      snapshot,
      organizationId,
      requesterUserId,
    )
      ? storedResponse(snapshot, categories)
      : null;
    if (!response) {
      await purgeOrganizationDataUsageProjectionInTransaction({
        organizationId,
        requesterUserId,
        tx,
      });
    }
    return response;
  });
}

export async function saveOrganizationDataUsageProjection(input: {
  readonly execSql: ExecSql;
  readonly requesterUserId: string;
  readonly response: OrganizationDataUsageResponse;
}): Promise<void> {
  const response = parseResponse(input.response);
  requireScope(response.organizationId, input.requesterUserId);
  await ensureSqlTables(input.execSql, [
    ...organizationDataUsageTables,
    ...organizationReadModelTables,
  ]);
  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
      // Storing an authoritative usage response proves access: retire any
      // durable denial marker for this scope in the same transaction.
      await clearOrganizationPresentationDenialInTransaction({
        organizationId: response.organizationId,
        projection: "usage",
        requesterUserId: input.requesterUserId,
        tx,
      });
      const scope = and(
        eq(
          organizationDataUsageCategories.organizationId,
          response.organizationId,
        ),
        eq(
          organizationDataUsageCategories.requesterUserId,
          input.requesterUserId,
        ),
      );
      await tx.delete(organizationDataUsageCategories).where(scope).run();

      const snapshot = {
        organizationId: response.organizationId,
        requesterUserId: input.requesterUserId,
        projectionVersion: ORGANIZATION_DATA_USAGE_PROJECTION_VERSION,
        blobCount: response.blobs.blobCount,
        blobByteLength: response.blobs.byteLength,
        documentByteLength: response.documents.byteLength,
        documentCount: response.documents.documentCount,
        documentUpdateCount: response.documents.updateCount,
        totalByteLength: response.totalByteLength,
        refreshedAt: new Date().toISOString(),
      };
      await tx
        .insert(organizationDataUsageSnapshots)
        .values(snapshot)
        .onConflictDoUpdate({
          target: [
            organizationDataUsageSnapshots.organizationId,
            organizationDataUsageSnapshots.requesterUserId,
          ],
          set: {
            projectionVersion: snapshot.projectionVersion,
            blobCount: snapshot.blobCount,
            blobByteLength: snapshot.blobByteLength,
            documentByteLength: snapshot.documentByteLength,
            documentCount: snapshot.documentCount,
            documentUpdateCount: snapshot.documentUpdateCount,
            totalByteLength: snapshot.totalByteLength,
            refreshedAt: snapshot.refreshedAt,
          },
        })
        .run();
      await tx
        .insert(organizationDataUsageCategories)
        .values(
          response.documents.breakdown.map((entry) => ({
            organizationId: response.organizationId,
            requesterUserId: input.requesterUserId,
            category: entry.category,
            byteLength: entry.byteLength,
            documentCount: entry.documentCount,
            updateCount: entry.updateCount,
          })),
        )
        .run();
    },
  );
}

export async function purgeOrganizationDataUsageProjection(
  execSql: ExecSql,
  organizationId: string,
  requesterUserId?: string,
): Promise<void> {
  requireScope(organizationId, requesterUserId);
  await ensureSqlTables(execSql, organizationDataUsageTables);
  await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    await purgeOrganizationDataUsageProjectionInTransaction({
      organizationId,
      requesterUserId,
      tx,
    });
  });
}
