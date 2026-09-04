import { readSignedGroupPolicyName } from "@tearleads/api-shared";
import { OrganizationManagerError } from "./errors";

// Group payloads currently carry signed plaintext base64 JSON despite the
// encrypted-payload wire field names; the client commits this same encoding.
export function assertCreatedGroupPolicyName(input: {
  readonly ciphertext: string;
  readonly name: string;
}): void {
  let name: string | null;
  try {
    name = readSignedGroupPolicyName(input.ciphertext);
  } catch {
    throw new OrganizationManagerError(
      "Group policy payload must commit its display name",
      400,
    );
  }
  if (name !== input.name) {
    throw new OrganizationManagerError(
      "Group name must match the signed policy display name",
      400,
    );
  }
}
