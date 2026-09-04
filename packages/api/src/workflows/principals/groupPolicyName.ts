import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { OrganizationManagerError } from "../organizations/errors";
import { assertCreatedGroupPolicyName } from "../organizations/groupPolicyName";
import { PrincipalPolicyError } from "./shared";

/** Group policy updates cannot drop or rename the signed creation label. */
export async function assertGroupPolicyNamePreserved(
  tx: DatabaseTransaction,
  input: PutPrincipalPolicyRequest,
): Promise<void> {
  if (input.state.principalType !== "group") return;
  const [group] = await tx
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, input.state.principalId))
    .limit(1);
  if (!group) throw new PrincipalPolicyError("Group not found", 404);
  try {
    assertCreatedGroupPolicyName({
      name: group.name,
      ciphertext: input.encryptedPayload.ciphertext,
    });
  } catch (error) {
    if (error instanceof OrganizationManagerError) {
      throw new PrincipalPolicyError(error.message, 400);
    }
    throw error;
  }
}
