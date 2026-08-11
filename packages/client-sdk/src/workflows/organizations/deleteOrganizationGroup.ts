import type { SigningKeyPair } from "@tearleads/crypto";
import type { DeleteOrganizationGroupRequest } from "@tearleads/validators/request";
import type { DeleteOrganizationGroupResponse } from "@tearleads/validators/response";
import { persistLocallyAcknowledgedPrincipalPolicyBundles } from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { loadOrganizationExternalAdminPolicy } from "../principals/externalAdminPolicy";
import {
  acknowledgeGroupPolicyState,
  assertGroupPolicyBundleMatchesAcknowledgement,
} from "./groupPolicyMutationAcknowledgement";
import type { PrincipalPolicyReadWriteApi } from "./groupPolicyMutationContext";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  removeOrganizationGroupHead,
} from "./organizationGroupDirectory";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "./trustedOrganizationUsers";

export async function deleteOrganizationGroup(input: {
  readonly apiClient: PrincipalPolicyReadWriteApi & {
    deleteOrganizationGroup: (
      organizationId: string,
      groupId: string,
      request: DeleteOrganizationGroupRequest,
    ) => Promise<DeleteOrganizationGroupResponse | null>;
  };
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<DeleteOrganizationGroupResponse> {
  const externalAdminPolicy = await loadOrganizationExternalAdminPolicy({
    execSql: input.execSql,
    getCurrentPrincipalPolicy: (principalType, principalId) =>
      input.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if (
    !externalAdminPolicy ||
    !externalAdminPolicy.signerUserIds.includes(input.signerUserId)
  ) {
    throw new Error("Organization admin authority could not be verified");
  }
  const adminProjection = externalAdminPolicy.adminBundle.currentProjection;
  const adminUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(adminProjection),
  });
  const organizationRequest =
    await buildOrganizationGroupDirectoryPolicyRequest({
      adminProjection,
      adminUsers,
      currentPolicy: externalAdminPolicy.bundle,
      descriptor: externalAdminPolicy.descriptor,
      groupHeads: removeOrganizationGroupHead({
        descriptor: externalAdminPolicy.descriptor,
        groupId: input.groupId,
      }),
      signerUserId: input.signerUserId,
      signingFingerprint: input.signingFingerprint,
      signingKeyPair: input.signingKeyPair,
    });
  const stored = await input.apiClient.deleteOrganizationGroup(
    input.organizationId,
    input.groupId,
    { organizationPolicy: organizationRequest },
  );
  if (!stored) {
    throw new Error("Group could not be deleted");
  }
  if (
    stored.organizationId !== input.organizationId ||
    stored.groupId !== input.groupId
  ) {
    throw new Error("Group deletion response target mismatch");
  }
  const organizationHead = await groupPolicyMutationHead(organizationRequest);
  const organizationPolicy = await acknowledgeGroupPolicyState({
    currentPolicy: externalAdminPolicy.bundle,
    expectedHead: organizationHead,
    request: organizationRequest,
    response: stored.organizationPolicy.currentState,
  });
  assertGroupPolicyBundleMatchesAcknowledgement({
    currentPolicy: externalAdminPolicy.bundle,
    expectedHead: organizationHead,
    request: organizationRequest,
    response: stored.organizationPolicy,
  });
  await persistLocallyAcknowledgedPrincipalPolicyBundles({
    entries: [
      { bundle: stored.organizationPolicy, policy: organizationPolicy },
    ],
    execSql: input.execSql,
    updatedAt: new Date().toISOString(),
  });
  return stored;
}
