import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type { OrganizationGroupMemberResponse } from "@tearleads/validators/response";
import { inArray } from "drizzle-orm";
import type { StoredPrincipalProjectionMember } from "../../access/read/principalStateStore";

export interface UserKeyRow {
  userId: string;
  defaultOrganizationId: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
  createdAt: Date;
}

export async function loadUsersById(
  executor: DatabaseSession,
  userIds: readonly string[],
): Promise<Map<string, UserKeyRow>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      userId: users.id,
      defaultOrganizationId: users.defaultOrganizationId,
      signingKeyFingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
      encapsulationPublicKey: users.encapsulationPublicKey,
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(inArray(users.id, [...userIds]));

  return new Map(rows.map((row) => [row.userId, row]));
}

export function toOrganizationGroupMemberResponse(input: {
  readonly member: StoredPrincipalProjectionMember;
  readonly usersById: ReadonlyMap<string, UserKeyRow>;
}): OrganizationGroupMemberResponse {
  const user = input.usersById.get(input.member.userId);

  return {
    userId: input.member.userId,
    role: input.member.role,
    signingKeyFingerprint: user?.signingKeyFingerprint ?? null,
    signingPublicKey: user?.signingPublicKey ?? null,
    encapsulationPublicKey: user?.encapsulationPublicKey ?? null,
    encapsulationKeyFingerprint: user?.encapsulationKeyFingerprint ?? null,
  };
}
