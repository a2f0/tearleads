import type {
  PrincipalPolicyCheckpoint,
  PrincipalPolicyExternalAuthority,
  ReferencedPrincipalHead,
  SigningKeyPair,
} from "@tearleads/crypto";
import type {
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalPolicyBundleResponse,
  PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import { retainLocallyAcknowledgedPrincipalPolicyBundles } from "../../../data/persistence/principalPolicy/locallyAcknowledgedPrincipalPolicyPersistence";
import { persistVerifiedPrincipalPolicyBundlesAtomically } from "../../../data/persistence/principalPolicy/verifiedPrincipalPolicyBundlePersistence";
import { requireOrganizationGroupHead } from "../../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import {
  externalAdminPolicyPersistenceEntries,
  loadOrganizationExternalAdminPolicy,
  type VerifiedExternalAdminPolicy,
} from "../../principals/externalAdminPolicy";
import { assertGroupMetadataBinding } from "../groupMetadata/groupMetadataBinding";
import type {
  PrincipalPolicyReadApi,
  PrincipalPolicyReadWriteApi,
} from "../principalPolicy/principalPolicyApi";
import { requireSignerCanManageGroup } from "./groupMutationAuthorization";
import {
  acknowledgeGroupPolicyState,
  assertGroupPolicyEnvelopesMatchAcknowledgement,
  buildAcknowledgedGroupPolicyBundle,
} from "./groupPolicyMutationAcknowledgement";
import type { FullGroupMembershipMutationInput } from "./groupPolicyMutationEvidence";
import {
  assertPrincipalPolicyCurrentStateMatchesHead,
  groupPolicyMutationHead,
} from "./groupPolicyMutationHead";
import {
  collectGroupPolicySignerPublicKeys,
  prepareGroupPolicyVerification,
  verifyGroupPolicy,
  verifyGroupPolicyWithExternalOrganizationAdmins,
} from "./groupPolicyVerification";
import { submitGroupPolicyCommit } from "./submitGroupPolicyCommit";

export type {
  OrganizationPrincipalPolicyApi,
  PrincipalPolicyReadApi,
  PrincipalPolicyReadWriteApi,
} from "../principalPolicy/principalPolicyApi";
export { submitGroupPolicyCommit } from "./submitGroupPolicyCommit";

interface LoadedGroupPolicyMutationContext
  extends FullGroupMembershipMutationInput {
  readonly adminGroupId: string;
  readonly adminPolicyBundle: PrincipalPolicyBundleResponse;
  readonly currentOrgAdminUserIds: readonly string[];
  readonly organizationDescriptor: VerifiedExternalAdminPolicy["descriptor"];
  readonly organizationPolicyBundle: PrincipalPolicyBundleResponse;
  readonly memberGroupId: string;
}

export async function cacheGroupPolicy(input: {
  readonly acknowledgedMemberEnvelopes?:
    | CurrentPrincipalMemberEnvelopesResponse
    | undefined;
  readonly apiClient: PrincipalPolicyReadApi;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
  readonly execSql: ExecSql;
  readonly expectedCurrentHead?: ReferencedPrincipalHead | undefined;
  readonly groupId: string;
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<PrincipalPolicyBundleResponse> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!bundle) {
    throw new Error("Updated group policy could not be loaded");
  }

  const signerPublicKeys = await collectGroupPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  const verified = await verifyGroupPolicy({
    currentPolicy: bundle,
    ...(input.externalAuthority
      ? { externalAuthority: input.externalAuthority }
      : {}),
    localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
    signerPublicKeys,
  });
  if (input.expectedCurrentHead) {
    assertPrincipalPolicyCurrentStateMatchesHead(
      bundle.currentState,
      input.expectedCurrentHead,
    );
  }
  if (input.acknowledgedMemberEnvelopes) {
    assertGroupPolicyEnvelopesMatchAcknowledgement(
      input.acknowledgedMemberEnvelopes,
      bundle.currentMemberEnvelopes,
    );
  }
  await persistVerifiedPrincipalPolicyBundlesAtomically({
    entries: [{ bundle, policy: verified }],
    execSql: input.execSql,
    organizationId: input.organizationId,
    stillCurrent: input.stillCurrent,
    updatedAt: new Date().toISOString(),
  });
  return bundle;
}

export async function loadGroupPolicyMutationContext(input: {
  readonly apiClient: PrincipalPolicyReadApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<LoadedGroupPolicyMutationContext> {
  await input.apiClient.recoverPendingPrincipalMutation?.(input.organizationId);
  const adminPolicy = await loadOrganizationExternalAdminPolicy({
    currentPolicyReader: input.apiClient,
    execSql: input.execSql,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if (!adminPolicy) {
    throw new Error("Organization admin authority could not be verified");
  }
  const expectedGroupHead = requireOrganizationGroupHead(
    adminPolicy.descriptor,
    input.groupId,
  );
  const currentPolicy =
    input.groupId === adminPolicy.adminGroupId
      ? adminPolicy.adminBundle
      : await input.apiClient.getCurrentPrincipalPolicy("group", input.groupId);
  if (!currentPolicy) {
    throw new Error("Group policy could not be loaded");
  }
  assertPrincipalPolicyCurrentStateMatchesHead(
    currentPolicy.currentState,
    expectedGroupHead,
  );
  const verification = await prepareGroupPolicyVerification({
    currentPolicy,
    execSql: input.execSql,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  const isOrganizationAdminsGroup = adminPolicy.adminGroupId === input.groupId;
  const currentOrgAdminUserIds = adminPolicy.signerUserIds;
  const externalAuthority = adminPolicy.externalAuthority;
  if (!currentOrgAdminUserIds.includes(input.signerUserId)) {
    throw new Error("Organization admin authority is required");
  }
  const verified = isOrganizationAdminsGroup
    ? await verifyGroupPolicy({
        currentPolicy,
        localPolicyCheckpoint: verification.localPolicyCheckpoint,
        signerPublicKeys: verification.currentPolicySignerPublicKeys,
      })
    : await verifyGroupPolicyWithExternalOrganizationAdmins({
        currentPolicy,
        loadExternalAuthority: async () => externalAuthority,
        localPolicyCheckpoint: verification.localPolicyCheckpoint,
        signerPublicKeys: verification.currentPolicySignerPublicKeys,
      });
  assertGroupMetadataBinding(currentPolicy, adminPolicy.descriptor);
  requireSignerCanManageGroup(
    currentPolicy,
    currentOrgAdminUserIds,
    input.signerUserId,
  );
  await persistVerifiedPrincipalPolicyBundlesAtomically({
    entries: [
      ...externalAdminPolicyPersistenceEntries(adminPolicy).filter(
        (entry) =>
          entry.policy.principalType !== verified.principalType ||
          entry.policy.principalId !== verified.principalId,
      ),
      { bundle: currentPolicy, policy: verified },
    ],
    execSql: input.execSql,
    organizationId: input.organizationId,
    updatedAt: new Date().toISOString(),
  });

  return {
    adminGroupId: adminPolicy.adminGroupId,
    adminPolicyBundle: adminPolicy.adminBundle,
    currentPolicy,
    currentOrgAdminUserIds,
    externalAuthority,
    isOrganizationAdminsGroup,
    memberGroupId: adminPolicy.memberGroupId,
    organizationDescriptor: adminPolicy.descriptor,
    organizationPolicyBundle: adminPolicy.bundle,
    ...verification,
    localPolicyCheckpoint: verified.checkpoint,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  };
}

export async function commitGroupPolicyMutation(input: {
  readonly retiredContainerIds?: (() => readonly string[]) | undefined;
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly expectedHead: ReferencedPrincipalHead;
  readonly groupId: string;
  readonly organizationId: string;
  readonly organizationPolicy: PrincipalPolicyBundleResponse;
  readonly organizationRequest: PutPrincipalPolicyRequest;
  /**
   * Re-sign the batch with the descendant rekeys a refusal named woven in; the
   * result replaces `containerMutations` and the commit is retried once.
   */
  readonly carryDescendantRekeys?:
    | ((
        requiredContainerIds: readonly string[],
      ) => Promise<readonly ContainerMutationRequest[]>)
    | undefined;
  readonly request: PutPrincipalPolicyRequest;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<PrincipalPolicyBundleResponse & PrincipalPolicyMutationResponse> {
  const stored = await submitGroupPolicyCommit(input);
  if (!stored) {
    throw new Error("Group policy update failed");
  }
  const storedPolicy = stored.groupPolicy;
  const acknowledgedPolicy = await acknowledgeGroupPolicyState({
    currentPolicy: input.currentPolicy,
    expectedHead: input.expectedHead,
    request: input.request,
    response: storedPolicy.currentState,
  });
  const groupBundle = await buildAcknowledgedGroupPolicyBundle({
    currentPolicy: input.currentPolicy,
    expectedHead: input.expectedHead,
    request: input.request,
    response: storedPolicy,
  });
  const organizationHead = await groupPolicyMutationHead(
    input.organizationRequest,
  );
  const acknowledgedOrganization = await acknowledgeGroupPolicyState({
    currentPolicy: input.organizationPolicy,
    expectedHead: organizationHead,
    request: input.organizationRequest,
    response: stored.organizationPolicy.currentState,
  });
  const organizationBundle = await buildAcknowledgedGroupPolicyBundle({
    currentPolicy: input.organizationPolicy,
    expectedHead: organizationHead,
    request: input.organizationRequest,
    response: stored.organizationPolicy,
  });
  await retainLocallyAcknowledgedPrincipalPolicyBundles({
    retiredContainers: {
      containerIds: input.retiredContainerIds?.() ?? [],
      organizationId: input.organizationId,
      policy: acknowledgedPolicy,
    },
    entries: [
      { bundle: groupBundle, policy: acknowledgedPolicy },
      {
        bundle: organizationBundle,
        policy: acknowledgedOrganization,
      },
    ],
    execSql: input.execSql,
    organizationId: input.organizationId,
    stillCurrent: input.stillCurrent,
    updatedAt: new Date().toISOString(),
  });
  return groupBundle;
}
