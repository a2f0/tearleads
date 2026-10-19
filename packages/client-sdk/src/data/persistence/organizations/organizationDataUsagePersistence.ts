import {
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
  type OrganizationDataUsageResponse,
  OrganizationDataUsageResponseSchema,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  ORGANIZATION_DATA_USAGE_PROJECTION_VERSION,
  organizationDataUsageSnapshots,
  organizationDataUsageTables,
} from "../../sqlite/schema/organizationDataUsageSchema";
import { organizationReadModelTables } from "../../sqlite/schema/organizationReadModelTableRegistry";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../sqlite/sqlTableSchema";
import { clearOrganizationPresentationDenialInTransaction } from "./organizationPresentationDenialPersistence";

type StoredSnapshot = typeof organizationDataUsageSnapshots.$inferSelect;

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
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

function parseStoredBreakdown(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// The stored breakdown is untrusted local JSON: the strict response schema
// re-checks every entry (known category, each exactly once, safe non-negative
// counts that sum to the stored totals) before it is served.
function storedResponse(
  snapshot: StoredSnapshot,
): OrganizationDataUsageResponse | null {
  const parsed = OrganizationDataUsageResponseSchema.safeParse({
    organizationId: snapshot.organizationId,
    blobs: {
      blobCount: snapshot.blobCount,
      byteLength: snapshot.blobByteLength,
    },
    documents: {
      breakdown: parseStoredBreakdown(snapshot.categoryBreakdownJson),
      byteLength: snapshot.documentByteLength,
      documentCount: snapshot.documentCount,
      updateCount: snapshot.documentUpdateCount,
    },
    totalByteLength: snapshot.totalByteLength,
  });
  return parsed.success ? parsed.data : null;
}

function canonicalBreakdownJson(
  response: OrganizationDataUsageResponse,
): string {
  const order = new Map<string, number>(
    ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.map((category, index) => [
      category,
      index,
    ]),
  );
  const breakdown = [...response.documents.breakdown]
    .sort(
      (left, right) =>
        (order.get(left.category) ?? 0) - (order.get(right.category) ?? 0),
    )
    .map((entry) => ({
      byteLength: entry.byteLength,
      category: entry.category,
      documentCount: entry.documentCount,
      updateCount: entry.updateCount,
    }));
  return JSON.stringify(breakdown);
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
    if (!snapshot) {
      return null;
    }
    const response = isStoredSnapshotValid(
      snapshot,
      organizationId,
      requesterUserId,
    )
      ? storedResponse(snapshot)
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
        categoryBreakdownJson: canonicalBreakdownJson(response),
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
            categoryBreakdownJson: snapshot.categoryBreakdownJson,
            refreshedAt: snapshot.refreshedAt,
          },
        })
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
