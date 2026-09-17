import { readGroupMetadata } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { OrganizationAuthorityDescriptor } from "../../data/principals/organizationAuthorityDescriptor";

/** Built-in labels derive from the role assigned by the signed organization. */
export function assertGroupMetadataBinding(
  bundle: PrincipalPolicyBundleResponse,
  descriptor: OrganizationAuthorityDescriptor,
): void {
  const groupId = bundle.currentState.principalId;
  const metadata = readGroupMetadata(bundle.currentPayload.ciphertext);
  const expectedRole =
    groupId === descriptor.adminGroupId
      ? "admins"
      : groupId === descriptor.memberGroupId
        ? "members"
        : null;
  if (
    "role" in metadata
      ? metadata.role !== expectedRole
      : expectedRole !== null ||
        metadata.organizationId !== descriptor.organizationId ||
        metadata.groupId !== groupId
  ) {
    throw new Error(
      "Group metadata does not match the signed organization directory",
    );
  }
}
