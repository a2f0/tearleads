import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { principalDirectoryBindings } from "@tearleads/api-shared/schema";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";

/** Called within the transaction that accepts the signed organization directory. */
export async function storePrincipalDirectoryBindings(input: {
  readonly executor: DatabaseTransaction;
  readonly organization: ReferencedPrincipalHead;
  readonly groupHeads: readonly ReferencedPrincipalHead[];
}): Promise<void> {
  for (let offset = 0; offset < input.groupHeads.length; offset += 100) {
    await input.executor
      .insert(principalDirectoryBindings)
      .values(
        input.groupHeads.slice(offset, offset + 100).map((head) => ({
          organizationId: input.organization.principalId,
          organizationVersion: input.organization.version,
          organizationStateHash: input.organization.stateHash,
          groupId: head.principalId,
          groupVersion: head.version,
          groupStateHash: head.stateHash,
        })),
      )
      .onConflictDoNothing({
        target: [
          principalDirectoryBindings.organizationId,
          principalDirectoryBindings.groupId,
          principalDirectoryBindings.groupStateHash,
        ],
      });
  }
}
