import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { storePrincipalDirectoryBindings } from "../../access/write/principalDirectoryBindings";
import { parseOrganizationAuthorityDescriptor } from "../organizations/organizationAuthorityDescriptor";
import { PrincipalPolicyError } from "./shared";

export async function storeVerifiedPrincipalDirectoryBindings(input: {
  readonly executor: DatabaseTransaction;
  readonly state: ReferencedPrincipalHead;
  readonly ciphertext: string;
}): Promise<void> {
  if (input.state.principalType !== "organization") return;
  const directory = parseOrganizationAuthorityDescriptor(input.ciphertext);
  if (!directory || directory.organizationId !== input.state.principalId)
    throw new PrincipalPolicyError(
      "Principal directory binding is invalid",
      409,
    );
  await storePrincipalDirectoryBindings({
    executor: input.executor,
    organization: input.state,
    groupHeads: directory.groupHeads,
  });
}
