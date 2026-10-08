import {
  type ContainerAccessManifestState,
  KeyingVerificationError,
  type PrincipalPolicyAuthorization,
} from "@tearleads/crypto";
import {
  type OrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../../data/principals/organizationAuthorityDescriptor";
import { principalPolicyEvidenceEntries } from "../../data/principals/principalPolicyEvidence";
import { MetadataRootBehindDirectoryError } from "./groupMetadataErrors";

/** Root bindings consume verified current grants and explicitly retained predecessor citations. */
export function assertMetadataRootBinding(input: {
  readonly authority: {
    readonly descriptor: OrganizationAuthorityDescriptor;
    readonly adminGroupId: string;
    readonly memberGroupId: string;
    readonly adminPolicy: PrincipalPolicyAuthorization;
  };
  readonly members: { readonly policy: PrincipalPolicyAuthorization };
  readonly organizationId: string;
  readonly state: ContainerAccessManifestState;
}): void {
  const { authority, state } = input;
  const expected = [
    {
      policy: authority.adminPolicy,
      id: authority.adminGroupId,
      level: "admin",
      grants: authority.adminPolicy.grants,
    },
    {
      policy: input.members.policy,
      id: authority.memberGroupId,
      level: "read",
      grants: input.members.policy.grants,
    },
  ];
  const cited = (groupId: string) =>
    state.referencedPrincipalHeads.find(
      (head) => head.principalType === "group" && head.principalId === groupId,
    );
  const unbound = new KeyingVerificationError(
    "object_mismatch",
    "Organization metadata root is not bound to the reserved group grants",
  );
  if (
    state.organizationId !== input.organizationId ||
    state.parentContainerId !== null ||
    state.directGrants.length !== 2 ||
    state.referencedPrincipalHeads.length !== 2 ||
    expected.some(
      (role) =>
        !principalHeadMatchesReference(
          role.policy.state,
          requireOrganizationGroupHead(authority.descriptor, role.id),
        ) ||
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
        !cited(role.id),
    )
  )
    throw unbound;
  const superseded = expected.flatMap((role) => {
    const head = cited(role.id);
    return head &&
      !principalHeadMatchesReference(
        head,
        requireOrganizationGroupHead(authority.descriptor, role.id),
      )
      ? [{ policy: role.policy, head }]
      : [];
  });
  if (superseded.length === 0) return;
  // A root read before a reserved-group commit cites a verified predecessor
  // of the directory's head; any other head is not an honest race.
  if (
    superseded.every(({ policy, head }) =>
      principalPolicyEvidenceEntries(policy).some(({ state }) =>
        principalHeadMatchesReference(state, head),
      ),
    )
  )
    throw new MetadataRootBehindDirectoryError();
  throw unbound;
}
