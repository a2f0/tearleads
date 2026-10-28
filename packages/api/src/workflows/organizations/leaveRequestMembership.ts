import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizations,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import type { OrganizationLeaveRequestMembersHead } from "@tearleads/validators/util";
import { and, eq, gte, notExists, sql } from "drizzle-orm";
import { OrganizationManagerError } from "./errors";

function membersStatesOf(memberGroupId: string) {
  return and(
    eq(principalStates.principalType, "group"),
    eq(principalStates.principalId, memberGroupId),
  );
}

/**
 * Refuses a leave request unless the Members head it cites is a stored state
 * of the organization's Members group and every Members state from that one on
 * still lists the member. Administrators' clients hide any other request, so
 * the server never stores one they would refuse: in particular, a request from
 * a membership that a removal has since ended.
 */
export async function assertLeaveRequestMembershipCurrent(
  executor: DatabaseSession,
  input: {
    readonly membersHead: OrganizationLeaveRequestMembersHead;
    readonly organizationId: string;
    readonly userId: string;
  },
): Promise<void> {
  const [organization] = await executor
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) {
    throw new OrganizationManagerError("Membership not found", 404);
  }
  const head = input.membersHead;
  if (head.principalId !== organization.memberGroupId) {
    throw new OrganizationManagerError(
      "Leave request cites a group other than Members",
      400,
    );
  }
  const [cited] = await executor
    .select({ version: principalStates.version })
    .from(principalStates)
    .where(
      and(
        membersStatesOf(organization.memberGroupId),
        eq(principalStates.version, head.version),
        eq(principalStates.stateHash, head.stateHash),
        eq(principalStates.keyEpoch, head.keyEpoch),
        eq(principalStates.keyFingerprint, head.keyFingerprint),
      ),
    )
    .limit(1);
  if (!cited) {
    throw new OrganizationManagerError(
      "Leave request cites an unknown Members state",
      409,
    );
  }
  const [lapsed] = await executor
    .select({ version: principalStates.version })
    .from(principalStates)
    .where(
      and(
        membersStatesOf(organization.memberGroupId),
        gte(principalStates.version, head.version),
        notExists(
          executor
            .select({ present: sql`1` })
            .from(principalMembershipProjection)
            .where(
              and(
                eq(
                  principalMembershipProjection.principalType,
                  principalStates.principalType,
                ),
                eq(
                  principalMembershipProjection.principalId,
                  principalStates.principalId,
                ),
                eq(
                  principalMembershipProjection.stateHash,
                  principalStates.stateHash,
                ),
                eq(principalMembershipProjection.userId, input.userId),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  if (lapsed) {
    throw new OrganizationManagerError(
      "Leave request predates the member's current membership",
      409,
    );
  }
}
