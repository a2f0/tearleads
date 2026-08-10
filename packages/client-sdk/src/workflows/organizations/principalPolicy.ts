import type {
  EncapsulationKeyPair,
  PrincipalPolicyExternalAuthority,
  ReferencedPrincipalHead,
  SigningKeyPair,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  OrganizationGroupSummaryResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { persistLocallyAcknowledgedPrincipalPolicyBundle } from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { loadOrganizationExternalAdminPolicy } from "../principals/externalAdminPolicy";
import {
  acknowledgeInitialGroupPolicy,
  prepareAuthoredGroupPolicy,
} from "./groupPolicyMutationAcknowledgement";
import {
  cacheGroupPolicy,
  commitGroupPolicyMutation,
  loadGroupPolicyMutationContext,
  type OrganizationPrincipalPolicyApi,
} from "./groupPolicyMutationContext";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import {
  buildAddGroupUserPolicyRequest,
  buildGroupAccessSetShrinkPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
} from "./groupPolicyRequests";
import {
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
} from "./principalPolicyRequest";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "./trustedOrganizationUsers";

export { buildInitialGroupPolicyRequest, buildInitialMemberGroupPolicyRequest };

async function commitAndCacheGroupPolicyMutation(input: {
  readonly afterPolicyCommitBeforeCache?: (() => Promise<void>) | undefined;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly beforePolicyCommit?:
    | ((head: ReferencedPrincipalHead) => void)
    | undefined;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly externalAuthority: PrincipalPolicyExternalAuthority | undefined;
  readonly groupId: string;
  readonly prepareContainerMutations?:
    | ((input: {
        readonly nextPolicy: VerifiedPrincipalPolicy;
      }) => Promise<ContainerMutationRequest[]>)
    | undefined;
  readonly request: PutPrincipalPolicyRequest;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<PrincipalPolicyBundleResponse> {
  const expectedHead = await groupPolicyMutationHead(input.request);
  input.beforePolicyCommit?.(expectedHead);
  if (input.prepareContainerMutations) {
    input.request.containerMutations = await input.prepareContainerMutations({
      nextPolicy: await prepareAuthoredGroupPolicy({
        currentPolicy: input.currentPolicy,
        expectedHead,
        request: input.request,
      }),
    });
  }
  const acknowledgedBundle = await commitGroupPolicyMutation({
    apiClient: input.apiClient,
    currentPolicy: input.currentPolicy,
    execSql: input.execSql,
    expectedHead,
    groupId: input.groupId,
    request: input.request,
  });
  await input.afterPolicyCommitBeforeCache?.();
  return cacheGroupPolicy({
    acknowledgedMemberEnvelopes: acknowledgedBundle.currentMemberEnvelopes,
    apiClient: input.apiClient,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    externalAuthority: input.externalAuthority,
    groupId: input.groupId,
    localPolicyCheckpoint: {
      principalId: expectedHead.principalId,
      principalType: expectedHead.principalType,
      stateHash: expectedHead.stateHash,
      version: expectedHead.version,
    },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}

export async function createOrganizationGroup(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly execSql: ExecSql;
  readonly name: string;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<OrganizationGroupSummaryResponse> {
  const externalAdminPolicy = await loadOrganizationExternalAdminPolicy({
    execSql: input.execSql,
    getCurrentPrincipalPolicy: (principalType, principalId) =>
      input.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if (!externalAdminPolicy) {
    throw new Error("Organization admin authority could not be verified");
  }
  if (!externalAdminPolicy.signerUserIds.includes(input.signerUserId)) {
    throw new Error("Organization admin authority could not be verified");
  }
  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: input.creatorEncapsulationKeyPair,
    externalAuthority: externalAdminPolicy.externalAuthority.currentHead,
    groupId: crypto.randomUUID(),
    includeSignerAsAdmin: false,
    name: input.name,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const group = await input.apiClient.createOrganizationGroup(
    input.organizationId,
    request,
  );

  if (!group) {
    throw new Error("Group could not be created");
  }
  const expectedHead = await groupPolicyMutationHead(
    request.initialGroupPolicy,
  );
  const acknowledged = await acknowledgeInitialGroupPolicy({
    organizationId: input.organizationId,
    request,
    response: group,
    stateHash: expectedHead.stateHash,
  });
  await persistLocallyAcknowledgedPrincipalPolicyBundle({
    bundle: acknowledged.bundle,
    execSql: input.execSql,
    policy: acknowledged.policy,
    updatedAt: new Date().toISOString(),
  });

  await cacheGroupPolicy({
    acknowledgedMemberEnvelopes: acknowledged.bundle.currentMemberEnvelopes,
    apiClient: input.apiClient,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    externalAuthority: externalAdminPolicy.externalAuthority,
    groupId: group.groupId,
    localPolicyCheckpoint: acknowledged.policy.checkpoint,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  return group;
}

export async function addOrganizationGroupUser(input: {
  readonly afterPolicyCommitBeforeCache?: (() => Promise<void>) | undefined;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly currentUserSecretKey: Uint8Array;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly targetUserId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly beforePolicyCommit: (
    head: ReferencedPrincipalHead,
    authority: {
      readonly adminGroupId: string;
      readonly memberGroupId: string;
    },
  ) => void;
  readonly prepareContainerMutations?:
    | ((input: {
        readonly nextPolicy: VerifiedPrincipalPolicy;
      }) => Promise<ContainerMutationRequest[]>)
    | undefined;
}): Promise<PrincipalPolicyBundleResponse> {
  const policyContext = await loadGroupPolicyMutationContext({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const identities = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: [
      ...projectionUserIds(policyContext.currentPolicy.currentProjection),
      input.targetUserId,
    ],
  });
  const targetUser = identities.find(
    (identity) => identity.userId === input.targetUserId,
  );
  if (!targetUser) {
    throw new Error(
      `User identity could not be loaded for ${input.targetUserId}`,
    );
  }
  const request = await buildAddGroupUserPolicyRequest({
    ...policyContext,
    currentUserSecretKey: input.currentUserSecretKey,
    currentUsers: identities.filter(
      (identity) => identity.userId !== input.targetUserId,
    ),
    targetUser,
  });
  return commitAndCacheGroupPolicyMutation({
    afterPolicyCommitBeforeCache: input.afterPolicyCommitBeforeCache,
    apiClient: input.apiClient,
    beforePolicyCommit: (head) =>
      input.beforePolicyCommit(head, {
        adminGroupId: policyContext.adminGroupId,
        memberGroupId: policyContext.memberGroupId,
      }),
    currentPolicy: policyContext.currentPolicy,
    execSql: input.execSql,
    externalAuthority: policyContext.externalAuthority,
    groupId: input.groupId,
    prepareContainerMutations: input.prepareContainerMutations,
    request,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}

export async function removeOrganizationGroupUser(input: {
  readonly afterPolicyCommitBeforeCache?: (() => Promise<void>) | undefined;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly removedUserId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly beforePolicyCommit: (
    head: ReferencedPrincipalHead,
    authority: {
      readonly adminGroupId: string;
      readonly memberGroupId: string;
    },
  ) => void;
  readonly prepareContainerMutations?:
    | ((input: {
        readonly nextPolicy: VerifiedPrincipalPolicy;
      }) => Promise<ContainerMutationRequest[]>)
    | undefined;
}): Promise<PrincipalPolicyBundleResponse> {
  const policyContext = await loadGroupPolicyMutationContext({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const removedKey = input.removedUserId;
  const projection = policyContext.currentPolicy.currentProjection.filter(
    (member) => member.userId !== removedKey,
  );
  if (
    projection.length === policyContext.currentPolicy.currentProjection.length
  ) {
    throw new Error("User is not a group member");
  }
  const remainingUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(projection),
  });
  const request = await buildRemoveGroupUserPolicyRequest({
    ...policyContext,
    remainingUsers,
    removedUserId: input.removedUserId,
  });
  return commitAndCacheGroupPolicyMutation({
    afterPolicyCommitBeforeCache: input.afterPolicyCommitBeforeCache,
    apiClient: input.apiClient,
    beforePolicyCommit: (head) =>
      input.beforePolicyCommit(head, {
        adminGroupId: policyContext.adminGroupId,
        memberGroupId: policyContext.memberGroupId,
      }),
    currentPolicy: policyContext.currentPolicy,
    execSql: input.execSql,
    externalAuthority: policyContext.externalAuthority,
    groupId: input.groupId,
    prepareContainerMutations: input.prepareContainerMutations,
    request,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}

/**
 * A group losing a container grant rotates its own key in the same request as
 * that container revoke and the rekeys of all remaining grants. This prevents
 * a later member from using the group's still-current key to open a retained
 * wrap from before the revoke.
 */
export async function rotateOrganizationGroupForAccessSetShrink(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly prepareContainerMutations: (input: {
    readonly nextPolicy: VerifiedPrincipalPolicy;
  }) => Promise<ContainerMutationRequest[]>;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PrincipalPolicyBundleResponse> {
  const policyContext = await loadGroupPolicyMutationContext({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const currentUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(policyContext.currentPolicy.currentProjection),
  });
  const request = await buildGroupAccessSetShrinkPolicyRequest({
    ...policyContext,
    currentUsers,
  });
  return commitAndCacheGroupPolicyMutation({
    apiClient: input.apiClient,
    currentPolicy: policyContext.currentPolicy,
    execSql: input.execSql,
    externalAuthority: policyContext.externalAuthority,
    groupId: input.groupId,
    prepareContainerMutations: input.prepareContainerMutations,
    request,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}
