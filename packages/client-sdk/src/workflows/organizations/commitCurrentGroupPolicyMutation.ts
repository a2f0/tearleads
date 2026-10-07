import type {
  SigningKeyPair,
  VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { prepareAuthoredGroupPolicy } from "./groupPolicyMutationAcknowledgement";
import {
  type PrincipalPolicyReadWriteApi,
  submitGroupPolicyCommit,
} from "./groupPolicyMutationContext";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "./organizationGroupDirectory";
import type { PreparedPrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";
import type { RuntimeCurrentGroupMutationContext } from "./runtimeCurrentGroupMutation";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "./trustedOrganizationUsers";

/** Commit and retain one exact compound successor without rebuilding full history. */
export async function commitCurrentGroupPolicyMutation(input: {
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly context: RuntimeCurrentGroupMutationContext;
  readonly groupId: string;
  readonly organizationId: string;
  readonly request: PutPrincipalPolicyRequest;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly prepareContainerMutations: (
    nextPolicy: VerifiedPrincipalPolicyCurrent,
  ) => Promise<PreparedPrincipalContainerRematerializationBatch>;
}): Promise<PrincipalPolicyMutationResponse> {
  const { context } = input;
  assertProjectionVerificationCurrent(context.stillCurrent);
  const [signer] = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: [input.signerUserId],
  });
  if (!signer) throw new Error("Group policy signer is unavailable");
  const expectedHead = await groupPolicyMutationHead(input.request);
  const nextPolicy = await prepareAuthoredGroupPolicy({
    verifiedCurrentPolicy: context.verifiedCurrentPolicy,
    expectedHead,
    request: input.request,
    signerPublicKeys: [signer],
    externalAuthority: context.externalAuthority,
    localPolicyCheckpoint: context.localPolicyCheckpoint,
    stillCurrent: context.stillCurrent,
  });
  const prepared = await input.prepareContainerMutations(nextPolicy);
  input.request.containerMutations = [...prepared.requests];
  const adminProjection = context.isOrganizationAdminsGroup
    ? input.request.projection
    : context.adminCurrent.current.currentProjection;
  const adminUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(adminProjection),
  });
  const organizationRequest =
    await buildOrganizationGroupDirectoryPolicyRequest({
      adminProjection,
      adminUsers,
      currentPolicy: context.organizationCurrent.current,
      descriptor: context.organizationDescriptor,
      groupHeads: replaceOrganizationGroupHead({
        descriptor: context.organizationDescriptor,
        nextHead: expectedHead,
      }),
      signerUserId: input.signerUserId,
      signingFingerprint: input.signingFingerprint,
      signingKeyPair: input.signingKeyPair,
    });
  assertProjectionVerificationCurrent(context.stillCurrent);
  const response = await submitGroupPolicyCommit({
    apiClient: input.apiClient,
    groupId: input.groupId,
    organizationId: input.organizationId,
    request: input.request,
    organizationRequest,
    carryDescendantRekeys: prepared.carry,
    stillCurrent: context.stillCurrent,
  });
  if (!response) throw new Error("Group policy update failed");
  assertProjectionVerificationCurrent(context.stillCurrent);
  await context.retainAcknowledged({
    request: input.request,
    organizationRequest,
    response,
    retiredContainerIds: prepared.retiredContainerIds,
  });
  await prepared.acknowledge(
    response.groupPolicy.containerMutations,
    context.stillCurrent,
  );
  assertProjectionVerificationCurrent(context.stillCurrent);
  return response.groupPolicy;
}
