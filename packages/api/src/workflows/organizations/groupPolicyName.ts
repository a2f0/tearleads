import { readGroupMetadata } from "@tearleads/crypto";
import { OrganizationManagerError } from "./errors";

/** The API checks opaque routing and shape; it never receives a display name. */
export function assertCreatedGroupPolicyName(input: {
  readonly ciphertext: string;
  readonly groupId: string;
  readonly organizationId: string;
  readonly builtinRole?: "admins" | "members";
}): void {
  try {
    const metadata = readGroupMetadata(input.ciphertext);
    if (input.builtinRole) {
      if (!("role" in metadata) || metadata.role !== input.builtinRole)
        throw new Error("Built-in group role does not match");
    } else if (
      "role" in metadata ||
      metadata.groupId !== input.groupId ||
      metadata.organizationId !== input.organizationId
    ) {
      throw new Error("Encrypted group metadata scope does not match");
    }
  } catch (cause) {
    throw new OrganizationManagerError(
      cause instanceof Error ? cause.message : "Invalid group metadata",
      400,
    );
  }
}
