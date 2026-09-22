import { db } from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  organizations,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";

/**
 * The share and group fixtures also enrol the recipient in the organization:
 * a roster row and Members-group projection membership, either of which
 * authorizes a principal policy read on its own. Strip both so only the
 * evidence under test remains. Call it after any policy commit that
 * re-verifies the Members policy against its projection.
 */
export async function stripOrganizationMembership(
  organizationId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, userId),
      ),
    );
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  await db
    .delete(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, "group"),
        eq(
          principalMembershipProjection.principalId,
          organization.memberGroupId,
        ),
        eq(principalMembershipProjection.userId, userId),
      ),
    );
}
