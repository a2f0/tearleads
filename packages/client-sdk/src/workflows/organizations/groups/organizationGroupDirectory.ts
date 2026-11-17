import type {
  ReferencedPrincipalHead,
  SigningKeyPair,
} from "@tearleads/crypto";
import type { OrganizationGroupSummaryResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import {
  normalizeOrganizationGroupHeads,
  type OrganizationAuthorityDescriptor,
  type OrganizationGroupHead,
} from "../../../data/principalContracts/organizationAuthorityDescriptor";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  organizationGroupHead,
} from "../../../data/principals/organizationGroupDirectoryRequest";
import type {
  buildInitialGroupPolicyRequest,
  GroupPolicyNameReader,
} from "../../../data/principals/principalPolicyRequest";
import type { SecurityIncidentReporter } from "../../../data/shared/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import type { loadOrganizationExternalAdminPolicy } from "../../principals/externalAdminPolicy";
import { assertGroupNameUniqueInDirectory } from "../groupNames/groupNameUniqueness";
import {
  acknowledgeGroupPolicyBundle,
  acknowledgeInitialGroupPolicy,
} from "../groupPolicy/groupPolicyMutationAcknowledgement";
import type { OrganizationPrincipalPolicyApi } from "../groupPolicy/groupPolicyMutationContext";
import { groupPolicyMutationHead } from "../groupPolicy/groupPolicyMutationHead";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "../trustedOrganizationUsers";

export function removeOrganizationGroupHead(input: {
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly groupId: string;
}): OrganizationGroupHead[] {
  if (
    input.groupId === input.descriptor.adminGroupId ||
    input.groupId === input.descriptor.memberGroupId
  ) {
    throw new Error("Built-in groups cannot be removed from the directory");
  }
  const groupHeads = input.descriptor.groupHeads.filter(
    (head) => head.principalId !== input.groupId,
  );
  if (groupHeads.length === input.descriptor.groupHeads.length) {
    throw new Error("Organization directory does not commit the deleted group");
  }
  return normalizeOrganizationGroupHeads(groupHeads);
}

export async function commitCreatedGroupToDirectory(input: {
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly name: string;
  readonly readEncryptedName?: GroupPolicyNameReader;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly externalAdminPolicy: NonNullable<
    Awaited<ReturnType<typeof loadOrganizationExternalAdminPolicy>>
  >;
  readonly organizationId: string;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly request: Awaited<ReturnType<typeof buildInitialGroupPolicyRequest>>;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<{
  readonly group: OrganizationGroupSummaryResponse;
  readonly head: ReferencedPrincipalHead;
}> {
  assertProjectionVerificationCurrent(input.stillCurrent);
  // Signed group names are unique per organization; refuse a collision before
  // anything reaches the server.
  await assertGroupNameUniqueInDirectory({
    apiClient: input.apiClient,
    descriptor: input.externalAdminPolicy.descriptor,
    execSql: input.execSql,
    externalAuthority: input.externalAdminPolicy.externalAuthority,
    name: input.name,
    readEncryptedName: input.readEncryptedName,
    organizationId: input.organizationId,
    reportSecurityIncident: input.reportSecurityIncident,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    stillCurrent: input.stillCurrent,
  });
  const expectedHead = await groupPolicyMutationHead(
    input.request.initialGroupPolicy,
  );
  const adminProjection =
    input.externalAdminPolicy.adminBundle.currentProjection;
  const adminUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(adminProjection),
  });
  const organizationRequest =
    await buildOrganizationGroupDirectoryPolicyRequest({
      adminProjection,
      adminUsers,
      currentPolicy: input.externalAdminPolicy.bundle,
      descriptor: input.externalAdminPolicy.descriptor,
      groupHeads: [
        ...input.externalAdminPolicy.descriptor.groupHeads,
        organizationGroupHead(expectedHead),
      ],
      signerUserId: input.signerUserId,
      signingFingerprint: input.signingFingerprint,
      signingKeyPair: input.signingKeyPair,
    });
  assertProjectionVerificationCurrent(input.stillCurrent);
  const stored = await input.apiClient.createOrganizationGroup(
    input.organizationId,
    { ...input.request, organizationPolicy: organizationRequest },
  );
  assertProjectionVerificationCurrent(input.stillCurrent);
  if (!stored) {
    throw new Error("Group could not be created");
  }
  const acknowledged = await acknowledgeInitialGroupPolicy({
    organizationId: input.organizationId,
    request: input.request,
    response: stored.group,
    stateHash: expectedHead.stateHash,
  });
  const organization = await acknowledgeGroupPolicyBundle({
    currentPolicy: input.externalAdminPolicy.bundle,
    expectedHead: await groupPolicyMutationHead(organizationRequest),
    request: organizationRequest,
    response: stored.organizationPolicy,
  });
  await new PrincipalPolicyBundleRepository(
    input.execSql,
  ).persistLocallyAcknowledgedPrincipalPolicyBundles({
    entries: [
      { bundle: acknowledged.bundle, policy: acknowledged.policy },
      organization,
    ],
    organizationId: input.organizationId,
    stillCurrent: input.stillCurrent,
  });
  assertProjectionVerificationCurrent(input.stillCurrent);
  return { group: stored.group, head: expectedHead };
}
