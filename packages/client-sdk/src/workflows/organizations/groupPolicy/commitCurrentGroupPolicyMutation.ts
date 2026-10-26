import type {
  SigningKeyPair,
  VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import type {
  PreparedPrincipalContainerRematerializationBatch,
  PrincipalRematerializationPredecessor,
} from "../../containers/rematerialization";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../groups/organizationGroupDirectory";
import { assertAuthoredPrincipalMutationReceipt } from "../principalMutations/principalMutationReceipt";
import type { RuntimeCurrentGroupMutationContext } from "../principalMutations/runtimeCurrentGroupMutation";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "../trustedOrganizationUsers";
import { prepareAuthoredGroupPolicy } from "./groupPolicyMutationAcknowledgement";
import {
  type PrincipalPolicyReadWriteApi,
  submitGroupPolicyCommit,
} from "./groupPolicyMutationContext";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";

interface GroupPolicyChange {
  readonly context: RuntimeCurrentGroupMutationContext;
  readonly request: PutPrincipalPolicyRequest;
  readonly prepareContainerMutations: (
    nextPolicy: VerifiedPrincipalPolicyCurrent,
    preceding?: PrincipalRematerializationPredecessor | undefined,
  ) => Promise<PreparedPrincipalContainerRematerializationBatch>;
}

interface CommitInput extends GroupPolicyChange {
  readonly member?: GroupPolicyChange | undefined;
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly groupId: string;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

/** Commit and retain the group, optional roster enrollment and directory together. */
export async function commitCurrentGroupPolicyMutation(
  input: CommitInput,
): Promise<PrincipalPolicyMutationResponse> {
  const { context } = input;
  assertProjectionVerificationCurrent(context.stillCurrent);
  const [signer] = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: [input.signerUserId],
  });
  if (!signer) throw new Error("Group policy signer is unavailable");
  const member = input.member
    ? await prepareChange(input.member, signer)
    : null;
  const { expectedHead, prepared } = await prepareChange(
    input,
    signer,
    member?.preceding,
  );
  const organizationRequest = await prepareDirectory(
    input,
    expectedHead,
    member?.expectedHead,
  );
  assertProjectionVerificationCurrent(context.stillCurrent);
  const response = await submitGroupPolicyCommit({
    apiClient: input.apiClient,
    groupId: input.groupId,
    organizationId: input.organizationId,
    request: input.request,
    organizationRequest,
    memberRequest: input.member?.request,
    // A compound retry must rebuild both batches' shared speculative heads.
    // Refuse the whole transaction if a damaged-key repair needs extra rekeys;
    // ordinary adds preserve key epochs and need no descendant carry retry.
    carryDescendantRekeys: member ? undefined : prepared.carry,
    stillCurrent: context.stillCurrent,
  });
  if (!response) throw new Error("Group policy update failed");
  assertProjectionVerificationCurrent(context.stillCurrent);
  await assertAuthoredPrincipalMutationReceipt(
    {
      groupPolicy: input.request,
      organizationPolicy: organizationRequest,
      ...(input.member ? { memberPolicy: input.member.request } : {}),
    },
    response,
  );
  await context.retainAcknowledged({
    additionalGroups:
      input.member && response.memberPolicy
        ? [
            {
              ...input.member.context.groupRetention,
              request: input.member.request,
              response: response.memberPolicy,
              retiredContainerIds: member?.prepared.retiredContainerIds,
            },
          ]
        : [],
    request: input.request,
    organizationRequest,
    response,
    retiredContainerIds: prepared.retiredContainerIds,
  });
  if (member && response.memberPolicy) {
    await member.prepared.acknowledge(
      response.memberPolicy.containerMutations,
      context.stillCurrent,
    );
  }
  await prepared.acknowledge(
    response.groupPolicy.containerMutations,
    context.stillCurrent,
  );
  assertProjectionVerificationCurrent(context.stillCurrent);
  return response.groupPolicy;
}

async function prepareChange(
  change: GroupPolicyChange,
  signer: Awaited<ReturnType<typeof resolveRequiredUserIdentities>>[number],
  preceding?: PrincipalRematerializationPredecessor,
) {
  const expectedHead = await groupPolicyMutationHead(change.request);
  const nextPolicy = await prepareAuthoredGroupPolicy({
    verifiedCurrentPolicy: change.context.verifiedCurrentPolicy,
    expectedHead,
    request: change.request,
    signerPublicKeys: [signer],
    externalAuthority: change.context.externalAuthority,
    localPolicyCheckpoint: change.context.localPolicyCheckpoint,
    stillCurrent: change.context.stillCurrent,
  });
  const authored = [
    ...(preceding?.authored ?? []),
    {
      organizationId: change.context.organizationDescriptor.organizationId,
      policy: nextPolicy,
      dependencies: [
        change.context.organizationCurrent.policy,
        change.context.adminCurrent.policy,
      ],
      stillCurrent: change.context.stillCurrent,
    },
  ];
  // A level the batch plans under its own rotation cites this successor
  // before the transaction commits, so the batch resolves it as authored,
  // exactly as the next group in a compound transaction does (#2646).
  const prepared = await change.prepareContainerMutations(nextPolicy, {
    policies: preceding?.policies ?? [],
    projections: preceding?.projections ?? [],
    knownContainerKeks: preceding?.knownContainerKeks ?? new Map(),
    authored,
  });
  change.request.containerMutations = [...prepared.requests];
  return {
    expectedHead,
    prepared,
    preceding: prepared.preceding
      ? { ...prepared.preceding, authored }
      : undefined,
  };
}

async function prepareDirectory(
  input: CommitInput,
  expectedHead: Awaited<ReturnType<typeof groupPolicyMutationHead>>,
  memberHead: Awaited<ReturnType<typeof groupPolicyMutationHead>> | undefined,
) {
  const { context } = input;
  if (
    input.member &&
    (input.member.context.currentPolicy.currentState.principalId !==
      context.memberGroupId ||
      input.member.context.organizationCurrent.current.currentState
        .stateHash !==
        context.organizationCurrent.current.currentState.stateHash)
  )
    throw new Error(
      "Roster and group changes must share the same organization policy",
    );
  let groupHeads = replaceOrganizationGroupHead({
    descriptor: context.organizationDescriptor,
    nextHead: expectedHead,
  });
  if (memberHead)
    groupHeads = replaceOrganizationGroupHead({
      descriptor: { ...context.organizationDescriptor, groupHeads },
      nextHead: memberHead,
    });
  const adminProjection = context.isOrganizationAdminsGroup
    ? input.request.projection
    : context.adminCurrent.current.currentProjection;
  const adminUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(adminProjection),
  });
  return buildOrganizationGroupDirectoryPolicyRequest({
    adminProjection,
    adminUsers,
    currentPolicy: context.organizationCurrent.current,
    descriptor: context.organizationDescriptor,
    groupHeads,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}
