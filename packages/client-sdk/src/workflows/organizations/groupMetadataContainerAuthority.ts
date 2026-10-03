import {
  type ContainerAccessManifestState,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  previousStatesIncludeHead,
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../../data/principals/organizationAuthorityDescriptor";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import { MetadataRootBehindDirectoryError } from "./groupMetadataErrors";
import { verifyDirectoryGroup } from "./groupNameUniqueness";
import { loadGroupNameDirectoryAuthority } from "./organizationGroupNamePolicies";

type Input = Omit<
  Parameters<typeof loadGroupNameDirectoryAuthority>[0],
  "organizationPolicyReference"
> & { readonly reportSecurityIncident: SecurityIncidentReporter };

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
    assertMetadataRootBinding({
      authority,
      members,
      organizationId: input.organizationId,
      state,
    });
    assertProjectionVerificationCurrent(input.stillCurrent);
  };
}

type DirectoryAuthority = NonNullable<
  Awaited<ReturnType<typeof loadGroupNameDirectoryAuthority>>
>;

function assertMetadataRootBinding(input: {
  readonly authority: DirectoryAuthority;
  readonly members: Awaited<ReturnType<typeof verifyDirectoryGroup>>;
  readonly organizationId: string;
  readonly state: ContainerAccessManifestState;
}): void {
  const { authority, state } = input;
  const expected = [
    {
      bundle: authority.adminBundle,
      id: authority.adminGroupId,
      level: "admin",
      grants: authority.adminPolicy.grants,
    },
    {
      bundle: input.members.bundle,
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
      ? [{ bundle: role.bundle, head }]
      : [];
  });
  if (superseded.length === 0) return;
  // A root read before a reserved-group commit cites a verified predecessor
  // of the directory's head; any other head is not an honest race.
  if (
    superseded.every(({ bundle, head }) =>
      previousStatesIncludeHead(bundle, head),
    )
  )
    throw new MetadataRootBehindDirectoryError();
  throw unbound;
}
