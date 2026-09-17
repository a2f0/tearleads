import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { readGroupMetadata } from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { PrincipalPolicyError } from "./shared";

/** Membership and grant updates preserve the signed, encrypted group metadata. */
export async function assertGroupPolicyNamePreserved(
  tx: DatabaseTransaction,
  input: PutPrincipalPolicyRequest,
  current: StoredPrincipalState | null,
): Promise<void> {
  if (input.state.principalType !== "group") return;
  if (!current) {
    const [group] = await tx
      .select()
      .from(groups)
      .where(eq(groups.id, input.state.principalId))
      .limit(1);
    if (!group) throw new PrincipalPolicyError("Group not found", 404);
    try {
      const metadata = readGroupMetadata(input.encryptedPayload.ciphertext);
      if (
        "role" in metadata ||
        metadata.groupId !== group.id ||
        metadata.organizationId !== group.organizationId
      )
        throw new Error("Invalid initial group metadata");
    } catch {
      throw new PrincipalPolicyError("Invalid initial group metadata", 400);
    }
    return;
  }
  if (current.payloadCiphertextHash !== input.encryptedPayload.ciphertextHash) {
    throw new PrincipalPolicyError(
      "Group metadata cannot change during a policy update",
      400,
    );
  }
}
