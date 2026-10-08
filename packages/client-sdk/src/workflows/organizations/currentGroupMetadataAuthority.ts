import type {
  ContainerAccessManifestState,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";
import { assertMetadataRootBinding } from "./groupMetadataRootBinding";

/** Authenticate metadata-root grants with current policies and only its cited predecessors. */
export function createCurrentGroupMetadataContainerVerifier(
  input: Omit<
    Parameters<typeof loadCurrentOrganizationAuthority>[0],
    "organizationReference"
  >,
) {
  return async (
    state: ContainerAccessManifestState,
    organizationReference?: ReferencedPrincipalHead,
  ): Promise<void> => {
    assertProjectionVerificationCurrent(input.stillCurrent);
    const authority = await loadCurrentOrganizationAuthority({
      ...input,
      organizationReference,
    });
    const { adminGroupId, memberGroupId } = authority.descriptor;
    const citation = (groupId: string) =>
      state.referencedPrincipalHeads.find(
        (head) =>
          head.principalType === "group" && head.principalId === groupId,
      );
    const admins = await authority.readGroup(
      adminGroupId,
      citation(adminGroupId),
    );
    const members = await authority.readGroup(
      memberGroupId,
      citation(memberGroupId),
    );
    assertMetadataRootBinding({
      organizationId: input.organizationId,
      authority: {
        descriptor: authority.descriptor,
        adminGroupId,
        memberGroupId,
        adminPolicy: admins.policy,
      },
      members,
      state,
    });
    assertProjectionVerificationCurrent(
      () =>
        authority.stillCurrent() &&
        admins.stillCurrent() &&
        members.stillCurrent(),
    );
  };
}
