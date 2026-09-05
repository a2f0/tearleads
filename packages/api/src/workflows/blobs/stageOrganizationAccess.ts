import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { blobStages, organizations } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import {
  assertOrganizationSyncEndpointAvailable,
  OrganizationSyncDisabledError,
} from "../billing/organizationSyncEligibility";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";

export async function requireBlobStageOrganizationAccess(
  executor: DatabaseSession,
  input: { readonly organizationId: string; readonly userId: string },
  error: (message: string, status: 403 | 409) => Error,
): Promise<void> {
  try {
    await requireDirectOrganizationAccess({ executor, ...input });
    await assertOrganizationSyncEndpointAvailable(
      executor,
      input.organizationId,
    );
  } catch (cause) {
    if (cause instanceof OrganizationManagerError && cause.status === 404) {
      throw error("Organization access denied", 403);
    }
    if (
      cause instanceof OrganizationManagerError &&
      (cause.status === 403 || cause.status === 409)
    ) {
      throw error(cause.message, cause.status);
    }
    if (cause instanceof OrganizationSyncDisabledError) {
      throw error("Organization is being purged", 409);
    }
    throw cause;
  }
}

/** Recheck after object-store I/O, serialized against organization purge. */
export async function persistBlobStageInOrganization(
  db: ApiDatabase,
  stage: typeof blobStages.$inferInsert,
  error: (message: string, status: 403 | 409) => Error,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Purge updates this same row before expiring stages and removing policies.
    // The stage either commits before that sweep or observes the purge here.
    await lockRowForUpdate(
      tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, stage.organizationId))
        .limit(1),
    );
    await requireBlobStageOrganizationAccess(
      tx,
      {
        organizationId: stage.organizationId,
        userId: stage.ownerUserId,
      },
      error,
    );
    await tx.insert(blobStages).values(stage);
  });
}
