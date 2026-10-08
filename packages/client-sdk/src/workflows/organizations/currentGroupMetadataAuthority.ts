import {
  type ContainerAccessManifestState,
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
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
    await createSelectedCurrentGroupMetadataContainerVerifier({
      authority,
      organizationId: input.organizationId,
      stillCurrent: input.stillCurrent,
    })(state, organizationReference);
  };
}

/** Reuse one mutation's verified authority without broadening its lease or scope. */
export function createSelectedCurrentGroupMetadataContainerVerifier(input: {
  readonly authority: Awaited<
    ReturnType<typeof loadCurrentOrganizationAuthority>
  >;
  readonly organizationId: string;
  readonly stillCurrent: () => boolean;
}) {
  return async (
    state: ContainerAccessManifestState,
    organizationReference?: ReferencedPrincipalHead,
  ): Promise<void> => {
    const { authority } = input;
    const stillCurrent = () => input.stillCurrent() && authority.stillCurrent();
    assertProjectionVerificationCurrent(stillCurrent);
    if (organizationReference) {
      if (
        organizationReference.principalType !== "organization" ||
        organizationReference.principalId !== input.organizationId
      )
        throw new KeyingVerificationError(
          "object_mismatch",
          "Current policy reference is outside its scope",
        );
      if (
        !principalHeadMatchesReference(
          authority.directory.policy.state,
          organizationReference,
        )
      )
        throw new ProjectionDependencyUnavailableError(
          "Metadata root belongs to a changed organization directory",
        );
    }
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
      () => stillCurrent() && admins.stillCurrent() && members.stillCurrent(),
    );
  };
}
