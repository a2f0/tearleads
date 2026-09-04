import { base64ToBytes } from "@tearleads/encoding";
import { OrganizationManagerError } from "./errors";

export function assertCreatedGroupPolicyName(input: {
  readonly ciphertext: string;
  readonly name: string;
}): void {
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64ToBytes(input.ciphertext)),
    );
  } catch {
    throw new OrganizationManagerError(
      "Group policy payload must commit its display name",
      400,
    );
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    Reflect.get(payload, "name") !== input.name
  ) {
    throw new OrganizationManagerError(
      "Group name must match the signed policy display name",
      400,
    );
  }
}
