import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import {
  blobAuditObjects,
  blobContentWriteHeaders,
  containers,
  documentContentWriteHeaders,
  organizationBilling,
} from "@symcrypt/api-shared/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  claimOrganizationForPurge,
  listOrganizationPurgeCandidates,
  normalizeOrganizationPurgeLimit,
} from "./organizationPurgeCandidates";
import { deleteOrganizationRemoteRows } from "./organizationPurgeRows";
import { loadOrganizationRemotePurgeScope } from "./organizationPurgeScope";

export interface OrganizationPurgeInput {
  readonly limit?: number | undefined;
  readonly now?: Date | undefined;
  readonly organizationIds?: readonly string[] | undefined;
}

export async function purgeClaimedOrganizationRemoteData(input: {
  readonly db: ApiDatabase;
  readonly now: Date;
  readonly organizationId: string;
}): Promise<void> {
  await input.db.transaction(async (tx) => {
    const scope = await loadOrganizationRemotePurgeScope({
      executor: tx,
      organizationId: input.organizationId,
    });
    await deleteOrganizationRemoteRows({
      executor: tx,
      now: input.now,
      organizationId: input.organizationId,
      scope,
    });
  });
}

export async function claimDueOrganizationPurges(
  db: ApiDatabase,
  input: OrganizationPurgeInput = {},
): Promise<{ readonly claimedOrganizationIds: string[]; readonly now: Date }> {
  const now = input.now ?? new Date();
  const limit = normalizeOrganizationPurgeLimit(input.limit);
  const candidates = input.organizationIds
    ? input.organizationIds.slice(0, limit)
    : await listOrganizationPurgeCandidates(db, { limit, now });
  const claimedOrganizationIds: string[] = [];
  for (const organizationId of candidates) {
    if (await claimOrganizationForPurge(db, organizationId, now)) {
      claimedOrganizationIds.push(organizationId);
    }
  }
  return { claimedOrganizationIds, now };
}

async function organizationPurgeIsComplete(
  db: ApiDatabase,
  organizationId: string,
): Promise<boolean> {
  const [container, documentHeader, blobHeader, pendingObject] =
    await Promise.all([
      db
        .select({ id: containers.id })
        .from(containers)
        .where(eq(containers.organizationId, organizationId))
        .limit(1),
      db
        .select({ id: documentContentWriteHeaders.documentId })
        .from(documentContentWriteHeaders)
        .where(eq(documentContentWriteHeaders.organizationId, organizationId))
        .limit(1),
      db
        .select({ id: blobContentWriteHeaders.blobId })
        .from(blobContentWriteHeaders)
        .where(eq(blobContentWriteHeaders.organizationId, organizationId))
        .limit(1),
      db
        .select({ id: blobAuditObjects.blobId })
        .from(blobAuditObjects)
        .where(
          and(
            eq(blobAuditObjects.organizationId, organizationId),
            isNotNull(blobAuditObjects.liveStorageKey),
            isNull(blobAuditObjects.objectDeletedAt),
          ),
        )
        .limit(1),
    ]);
  return (
    container.length === 0 &&
    documentHeader.length === 0 &&
    blobHeader.length === 0 &&
    pendingObject.length === 0
  );
}

export async function finalizeOrganizationPurge(input: {
  readonly db: ApiDatabase;
  readonly now: Date;
  readonly organizationId: string;
}): Promise<boolean> {
  if (!(await organizationPurgeIsComplete(input.db, input.organizationId))) {
    return false;
  }
  const [updated] = await input.db
    .update(organizationBilling)
    .set({ purgedAt: input.now, status: "purged", updatedAt: input.now })
    .where(
      and(
        eq(organizationBilling.organizationId, input.organizationId),
        eq(organizationBilling.status, "deleting"),
      ),
    )
    .returning({ organizationId: organizationBilling.organizationId });
  return updated !== undefined;
}
