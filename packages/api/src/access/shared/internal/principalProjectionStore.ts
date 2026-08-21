import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { principalMembershipProjection } from "@symcrypt/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@symcrypt/crypto";
import { and, eq } from "drizzle-orm";
import {
  principalProjectionMemberSelect,
  type StoredPrincipalProjectionMember,
  toStoredProjectionMember,
} from "./principalStateRecords";

export async function listProjectionMembersForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalProjectionMember[]> {
  const rows = await executor
    .select(principalProjectionMemberSelect)
    .from(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, principalType),
        eq(principalMembershipProjection.principalId, principalId),
        eq(principalMembershipProjection.stateHash, stateHash),
      ),
    )
    .orderBy(principalMembershipProjection.userId);
  return rows.map(toStoredProjectionMember);
}
