import type {
  EncapsulationKeyPair,
  PrincipalPolicyExternalAuthority,
  ReferencedPrincipalHead,
  SigningKeyPair,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@symcrypt/validators/request";
import type {
  ContainerMutationResponse,
  OrganizationGroupSummaryResponse,
  PrincipalPolicyBundleResponse,
  PrincipalPolicyMutationResponse,
} from "@symcrypt/validators/response";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { loadOrganizationExternalAdminPolicy } from "../principals/externalAdminPolicy";
import { prepareAuthoredGroupPolicy } from "./groupPolicyMutationAcknowledgement";
import {
  cacheGroupPolicy,
  commitGroupPolicyMutation,
  loadGroupPolicyMutationContext,
  type OrganizationPrincipalPolicyApi,
  type PrincipalPolicyReadWriteApi,
} from "./groupPolicyMutationContext";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import {
  buildAddGroupUserPolicyRequest,
  buildGroupAccessSetShrinkPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
  buildSetGroupContainerGrantPolicyRequest,
} from "./groupPolicyRequests";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  commitCreatedGroupToDirectory,
  replaceOrganizationGroupHead,
} from "./organizationGroupDirectory";
import {
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
} from "./principalPolicyRequest";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "./trustedOrganizationUsers";

export { buildInitialGroupPolicyRequest, buildInitialMemberGroupPolicyRequest };

interface PreparedGroupContainerMutations {
  readonly acknowledge: (
    responses: readonly ContainerMutationResponse[],
  ) => Promise<void>;
  readonly requests: readonly ContainerMutationRequest[];
}

type PrepareGroupContainerMutations = (input: {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly nextPolicy: VerifiedPrincipalPolicy;
}) => Promise<
  readonly ContainerMutationRequest[] | PreparedGroupContainerMutations
>;

async function commitAndCacheGroupPolicyMutation(input: {
  readonly afterPolicyCommitBeforeCache?: (() => Promise<void>) | undefined;
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly beforePolicyCommit?:
    | ((head: ReferencedPrincipalHead) => void)
    | undefined;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly externalAuthority: PrincipalPolicyExternalAuthority | undefined;
  readonly groupId: string;
  readonly organizationId: string;
  readonly policyContext: Awaited<
    ReturnType<typeof loadGroupPolicyMutationContext>
  >;
  readonly prepareContainerMutations?:
    | PrepareGroupContainerMutations
    | undefined;
  readonly request: PutPrincipalPolicyRequest;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<PrincipalPolicyMutationResponse> {
  const expectedHead = await groupPolicyMutationHead(input.request);
  input.beforePolicyCommit?.(expectedHead);
  let acknowledgeContainerMutations:
    | PreparedGroupContainerMutations["acknowledge"]
    | undefined;
  if (input.prepareContainerMutations) {
    const prepared = await input.prepareContainerMutations({
      currentPolicy: input.currentPolicy,
      nextPolicy: await prepareAuthoredGroupPolicy({
        currentPolicy: input.currentPolicy,
        expectedHead,
        request: input.request,
      }),
    });
    if ("requests" in prepared) {
      input.request.containerMutations = [...prepared.requests];
      acknowledgeContainerMutations = prepared.acknowledge;
    } else {
      input.request.containerMutations = [...prepared];
    }
  }
  const nextAdminProjection = input.policyContext.isOrganizationAdminsGroup
    ? input.request.projection
    : input.policyContext.adminPolicyBundle.currentProjection;
  const adminUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(nextAdminProjection),
  });
  const organizationRequest =
    await buildOrganizationGroupDirectoryPolicyRequest({
      adminProjection: nextAdminProjection,
      adminUsers,
      currentPolicy: input.policyContext.organizationPolicyBundle,
      descriptor: input.policyContext.organizationDescriptor,
      groupHeads: replaceOrganizationGroupHead({
        descriptor: input.policyContext.organizationDescriptor,
        nextHead: expectedHead,
      }),
      signerUserId: input.policyContext.signerUserId,
      signingFingerprint: input.policyContext.signingFingerprint,
      signingKeyPair: input.policyContext.signingKeyPair,
    });
  const acknowledgedBundle = await commitGroupPolicyMutation({
    apiClient: input.apiClient,
    currentPolicy: input.currentPolicy,
    execSql: input.execSql,
    expectedHead,
    groupId: input.groupId,
    organizationId: input.organizationId,
    organizationPolicy: input.policyContext.organizationPolicyBundle,
    organizationRequest,
    request: input.request,
  });
  if (acknowledgeContainerMutations) {
    await acknowledgeContainerMutations(acknowledgedBundle.containerMutations);
  }
  await input.afterPolicyCommitBeforeCache?.();
  await cacheGroupPolicy({
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
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  return acknowledgedBundle;
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
  const { group, head: expectedHead } = await commitCreatedGroupToDirectory({
    ...input,
    externalAdminPolicy,
    request,
  });

  await cacheGroupPolicy({
    acknowledgedMemberEnvelopes: {
      envelopes: request.initialGroupPolicy.memberEnvelopes,
      epoch: request.initialGroupPolicy.state.keyEpoch,
      principalId: request.groupId,
      principalType: "group",
      stateHash: expectedHead.stateHash,
    },
    apiClient: input.apiClient,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    externalAuthority: externalAdminPolicy.externalAuthority,
    groupId: group.groupId,
    localPolicyCheckpoint: {
      principalId: request.groupId,
      principalType: "group",
      stateHash: expectedHead.stateHash,
      version: expectedHead.version,
    },
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  return group;
}

export async function addOrganizationGroupUser(input: {
  readonly afterPolicyCommitBeforeCache?: (() => Promise<void>) | undefined;
  readonly apiClient: PrincipalPolicyReadWriteApi;
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
    | PrepareGroupContainerMutations
    | undefined;
}): Promise<PrincipalPolicyMutationResponse> {
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
    organizationId: input.organizationId,
    policyContext,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}

export async function removeOrganizationGroupUser(input: {
  readonly afterPolicyCommitBeforeCache?: (() => Promise<void>) | undefined;
  readonly apiClient: PrincipalPolicyReadWriteApi;
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
    | PrepareGroupContainerMutations
    | undefined;
}): Promise<PrincipalPolicyMutationResponse> {
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
    organizationId: input.organizationId,
    policyContext,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}

/**
 * Adds or changes one container in the group's signed complete grant set and
 * commits every resulting container rematerialization in the same request.
 */
export async function setOrganizationGroupContainerGrant(input: {
  readonly accessLevel: "admin" | "read" | "write";
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly containerId: string;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly prepareContainerMutations: PrepareGroupContainerMutations;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PrincipalPolicyMutationResponse> {
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
  const request = await buildSetGroupContainerGrantPolicyRequest({
    ...policyContext,
    accessLevel: input.accessLevel,
    containerId: input.containerId,
  });
  return commitAndCacheGroupPolicyMutation({
    apiClient: input.apiClient,
    currentPolicy: policyContext.currentPolicy,
    execSql: input.execSql,
    externalAuthority: policyContext.externalAuthority,
    groupId: input.groupId,
    prepareContainerMutations: input.prepareContainerMutations,
    request,
    organizationId: input.organizationId,
    policyContext,
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
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly revokedContainerId: string;
  readonly prepareContainerMutations: PrepareGroupContainerMutations;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PrincipalPolicyMutationResponse> {
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
    revokedContainerId: input.revokedContainerId,
  });
  return commitAndCacheGroupPolicyMutation({
    apiClient: input.apiClient,
    currentPolicy: policyContext.currentPolicy,
    execSql: input.execSql,
    externalAuthority: policyContext.externalAuthority,
    groupId: input.groupId,
    prepareContainerMutations: input.prepareContainerMutations,
    request,
    organizationId: input.organizationId,
    policyContext,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}
