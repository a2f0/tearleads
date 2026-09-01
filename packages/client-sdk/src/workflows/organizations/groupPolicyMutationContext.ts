import type {
  PrincipalPolicyCheckpoint,
  PrincipalPolicyExternalAuthority,
  PrincipalPolicySignerPublicKey,
  ReferencedPrincipalHead,
  SigningKeyPair,
} from "@tearleads/crypto";
import type {
  CommitOrganizationGroupPolicyRequest,
  CreateOrganizationGroupWithPolicyRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  CommitOrganizationGroupPolicyResponse,
  CreateOrganizationGroupResponse,
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalPolicyBundleResponse,
  PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import { persistVerifiedPrincipalPolicyBundlesAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { retainLocallyAcknowledgedPrincipalPolicyBundles } from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import { requireOrganizationGroupHead } from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  externalAdminPolicyPersistenceEntries,
  loadOrganizationExternalAdminPolicy,
  type VerifiedExternalAdminPolicy,
} from "../principals/externalAdminPolicy";
import { requireSignerCanManageGroup } from "./groupMutationAuthorization";
import {
  acknowledgeGroupPolicyState,
  assertGroupPolicyBundleMatchesAcknowledgement,
  assertGroupPolicyEnvelopesMatchAcknowledgement,
} from "./groupPolicyMutationAcknowledgement";
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

export interface PrincipalPolicyReadApi {
  getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
}

export interface PrincipalPolicyReadWriteApi extends PrincipalPolicyReadApi {
  commitOrganizationGroupPolicy: (
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
  ) => Promise<CommitOrganizationGroupPolicyResponse | null>;
}

export interface OrganizationPrincipalPolicyApi extends PrincipalPolicyReadApi {
  createOrganizationGroup: (
    organizationId: string,
    input: CreateOrganizationGroupWithPolicyRequest,
  ) => Promise<CreateOrganizationGroupResponse | null>;
}

export interface BuildGroupMembershipMutationInput {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly currentPolicySignerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly currentOrgAdminUserIds?: readonly string[] | undefined;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
  readonly isOrganizationAdminsGroup?: boolean | undefined;
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

interface LoadedGroupPolicyMutationContext
  extends BuildGroupMembershipMutationInput {
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
  const adminPolicy = await loadOrganizationExternalAdminPolicy({
    execSql: input.execSql,
    getCurrentPrincipalPolicy: (principalType, principalId) =>
      input.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
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
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly expectedHead: ReferencedPrincipalHead;
  readonly groupId: string;
  readonly organizationId: string;
  readonly organizationPolicy: PrincipalPolicyBundleResponse;
  readonly organizationRequest: PutPrincipalPolicyRequest;
  readonly request: PutPrincipalPolicyRequest;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<PrincipalPolicyMutationResponse> {
  const stored = await input.apiClient.commitOrganizationGroupPolicy(
    input.organizationId,
    input.groupId,
    {
      groupPolicy: input.request,
      organizationPolicy: input.organizationRequest,
    },
  );

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
  assertGroupPolicyBundleMatchesAcknowledgement({
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
  assertGroupPolicyBundleMatchesAcknowledgement({
    currentPolicy: input.organizationPolicy,
    expectedHead: organizationHead,
    request: input.organizationRequest,
    response: stored.organizationPolicy,
  });
  await retainLocallyAcknowledgedPrincipalPolicyBundles({
    entries: [
      { bundle: storedPolicy, policy: acknowledgedPolicy },
      {
        bundle: stored.organizationPolicy,
        policy: acknowledgedOrganization,
      },
    ],
    execSql: input.execSql,
    organizationId: input.organizationId,
    stillCurrent: input.stillCurrent,
    updatedAt: new Date().toISOString(),
  });
  return storedPolicy;
}
