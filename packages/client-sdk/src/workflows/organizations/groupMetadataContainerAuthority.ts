import {
  type ContainerAccessManifestState,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../../data/principals/organizationAuthorityDescriptor";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import { verifyDirectoryGroup } from "./groupNameUniqueness";
import { loadGroupNameDirectoryAuthority } from "./organizationGroupNamePolicies";

type Input = Omit<
  Parameters<typeof loadGroupNameDirectoryAuthority>[0],
  "organizationPolicyReference"
>;

/** A public system slot alone cannot bind a self-authorized root to an organization. */
export function createGroupMetadataContainerVerifier(input: Input) {
  return async (state: ContainerAccessManifestState): Promise<void> => {
    assertProjectionVerificationCurrent(input.stillCurrent);
    const cached = await loadPrincipalPolicyBundle(
      input.execSql,
      "organization",
      input.organizationId,
    );
    let authority = await loadGroupNameDirectoryAuthority({
      ...input,
      organizationPolicyReference: cached
        ? principalPolicyReferenceFromBundle(cached)
        : null,
    });
    if (
      cached &&
      authority &&
      state.referencedPrincipalHeads.some(
        (head) =>
          !authority?.descriptor.groupHeads.some((known) =>
            principalHeadMatchesReference(head, known),
          ),
      )
    ) {
      authority = await loadGroupNameDirectoryAuthority(input);
    }
    if (!authority)
      throw new Error("Organization metadata authority is unavailable");
    const memberHead = requireOrganizationGroupHead(
      authority.descriptor,
      authority.memberGroupId,
    );
    const members = await verifyDirectoryGroup(
      {
        ...input,
        descriptor: authority.descriptor,
        externalAuthority: authority.externalAuthority,
      },
      memberHead,
    );
    const expected = [
      {
        id: authority.adminGroupId,
        level: "admin",
        grants: authority.adminPolicy.grants,
      },
      {
        id: authority.memberGroupId,
        level: "read",
        grants: members.policy.grants,
      },
    ];
    if (
      state.organizationId !== input.organizationId ||
      state.parentContainerId !== null ||
      state.directGrants.length !== 2 ||
      state.referencedPrincipalHeads.length !== 2 ||
      expected.some(
        (role) =>
          !role.grants.some(
            (grant) =>
              grant.containerId === state.containerId &&
              grant.accessLevel === role.level,
          ) ||
          !state.directGrants.some(
            (grant) =>
              grant.subjectType === "group" &&
              grant.subjectId === role.id &&
              grant.accessLevel === role.level,
          ) ||
          !state.referencedPrincipalHeads.some((head) =>
            principalHeadMatchesReference(
              head,
              requireOrganizationGroupHead(authority.descriptor, role.id),
            ),
          ),
      )
    )
      throw new KeyingVerificationError(
        "object_mismatch",
        "Organization metadata root is not bound to the reserved group grants",
      );
    assertProjectionVerificationCurrent(input.stillCurrent);
  };
}
