import type { ContainerAccessManifestState } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import {
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../../../data/principals/organizationAuthorityDescriptor";
import { principalPolicyReferenceFromBundle } from "../../../data/principals/principalPolicyAdminSigners";
import type { SecurityIncidentReporter } from "../../../data/shared/securityIncidents";
import { verifyDirectoryGroup } from "../groupNames/groupNameUniqueness";
import { loadGroupNameDirectoryAuthority } from "../groupNames/organizationGroupNamePolicies";
import { assertMetadataRootBinding } from "./groupMetadataRootBinding";

type Input = Omit<
  Parameters<typeof loadGroupNameDirectoryAuthority>[0],
  "organizationPolicyReference"
> & { readonly reportSecurityIncident: SecurityIncidentReporter };

/** A public system slot alone cannot bind a self-authorized root to an organization. */
export function createGroupMetadataContainerVerifier(input: Input) {
  return async (state: ContainerAccessManifestState): Promise<void> => {
    assertProjectionVerificationCurrent(input.stillCurrent);
    const cached = await new PrincipalPolicyBundleRepository(
      input.execSql,
    ).loadPrincipalPolicyBundle("organization", input.organizationId);
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
