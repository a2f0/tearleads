import type { UpdateOrganizationProfileRequest } from "@tearleads/validators/request";
import type { OrganizationProfileResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import type { ApiDatabase } from "../../adapters/postgres";
import { organizations } from "../../schema";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import { isOrganizationProfileDocument } from "./roster";

export async function runUpdateOrganizationProfileWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  input: UpdateOrganizationProfileRequest,
): Promise<OrganizationProfileResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      requireAdmin: true,
      userId: sessionUserId,
    });

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

    const [organization] = await tx
      .update(organizations)
      .set({ profileDocumentId: input.profileDocumentId })
      .where(eq(organizations.id, organizationId))
      .returning({
        organizationId: organizations.id,
        profileDocumentId: organizations.profileDocumentId,
      });
    if (!organization) {
      throw new OrganizationManagerError("Organization not found", 404);
    }

    return organization;
  });
}
