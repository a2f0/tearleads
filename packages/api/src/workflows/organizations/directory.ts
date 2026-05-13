import type { OrganizationDirectoryResponse } from "@tearleads/validators/response";
import { listCurrentPrincipalProjectionMembers } from "../../access/read/principalStateStore";
import type { ApiDatabase } from "../../adapters/postgres";
import { requireDirectOrganizationAccess } from "./access";
import { loadUsersById } from "./users";

export async function runListOrganizationDirectoryWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationDirectoryResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });

    const projection = await listCurrentPrincipalProjectionMembers(
      "organization",
      organizationId,
      tx,
    );
    const directUserMembers = projection.filter(
      (entry) => entry.memberPrincipalType === "user",
    );
    const usersById = await loadUsersById(
      tx,
      directUserMembers.map((member) => member.memberPrincipalId),
    );

    return {
      organizationId,
      users: directUserMembers
        .flatMap((member) => {
          const user = usersById.get(member.memberPrincipalId);
          if (!user) {
            return [];
          }

          return [
            {
              userId: user.userId,
              signingKeyFingerprint: user.signingKeyFingerprint,
              signingPublicKey: user.signingPublicKey,
              encapsulationPublicKey: user.encapsulationPublicKey,
              encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
              role: member.role,
              createdAt: user.createdAt.toISOString(),
              isSelf: user.userId === sessionUserId,
            },
          ];
        })
        .sort((left, right) =>
          left.role === right.role
            ? left.userId.localeCompare(right.userId)
            : left.role === "admin"
              ? -1
              : 1,
        ),
    };
  });
}
