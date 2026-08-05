import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import type { UpdateOrganizationProfileRequest } from "@tearleads/validators/request";
import type { OrganizationProfileResponse } from "@tearleads/validators/response";
import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";
import { OrganizationManagerError } from "./errors";
import { requireSerializedOrganizationMutationAccess } from "./mutationAccess";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";
import { isOrganizationProfileDocument } from "./roster";

export async function runUpdateOrganizationProfileWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  input: UpdateOrganizationProfileRequest,
): Promise<OrganizationProfileResponse> {
  return db.transaction(async (tx) => {
    await requireSerializedOrganizationMutationAccess({
      organizationId,
      requireAdmin: true,
      tx,
      userId: sessionUserId,
    });
    await assertOrganizationCanSync(tx, organizationId, sessionUserId);

    if (
      input.profileDocumentId &&
      !(await isOrganizationProfileDocument({
        executor: tx,
        organizationId,
        profileDocumentId: input.profileDocumentId,
      }))
    ) {
      throw new OrganizationManagerError(
        "Profile document is not in this organization",
        400,
      );
    }

    const profileDocumentChanged =
      input.profileDocumentId === null
        ? isNotNull(organizations.profileDocumentId)
        : or(
            isNull(organizations.profileDocumentId),
            ne(organizations.profileDocumentId, input.profileDocumentId),
          );
    const [updatedOrganization] = await tx
      .update(organizations)
      .set({ profileDocumentId: input.profileDocumentId })
      .where(and(eq(organizations.id, organizationId), profileDocumentChanged))
      .returning({
        organizationId: organizations.id,
        profileDocumentId: organizations.profileDocumentId,
      });
    if (updatedOrganization) {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId,
        lane: "directory",
        entityId: organizationId,
        operation: "replace",
      });
    }

    return (
      updatedOrganization ?? {
        organizationId,
        profileDocumentId: input.profileDocumentId,
      }
    );
  });
}
