import type {
  PrincipalPolicyCheckpoint,
  PrincipalPolicyExternalAuthority,
  PrincipalPolicySignerPublicKey,
  ReferencedPrincipalHead,
  SigningKeyPair,
} from "@tearleads/crypto";
import type {
  CreateOrganizationGroupRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  OrganizationGroupSummaryResponse,
  PrincipalPolicyBundleResponse,
  PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import {
  advanceKeyingCheckpointsAtomically,
  persistVerifiedPrincipalPolicyBundlesAtomically,
} from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { retainLocallyAcknowledgedPrincipalPolicyBundle } from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  externalAdminPolicyPersistenceEntries,
  loadOrganizationExternalAdminPolicy,
} from "../principals/externalAdminPolicy";
import { requireSignerCanManageGroup } from "./groupMutationAuthorization";
import {
  acknowledgeGroupPolicyState,
  assertGroupPolicyBundleMatchesAcknowledgement,
  assertGroupPolicyEnvelopesMatchAcknowledgement,
} from "./groupPolicyMutationAcknowledgement";
import { assertPrincipalPolicyCurrentStateMatchesHead } from "./groupPolicyMutationHead";
import {
  collectGroupPolicySignerPublicKeys,
  prepareGroupPolicyVerification,
  verifyGroupPolicy,
  verifyGroupPolicyWithExternalOrganizationAdmins,
} from "./groupPolicyVerification";

export interface PrincipalPolicyReadWriteApi {
  getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  putPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalPolicyRequest,
  ) => Promise<PrincipalPolicyMutationResponse | null>;
}

export interface OrganizationPrincipalPolicyApi
  extends PrincipalPolicyReadWriteApi {
  createOrganizationGroup: (
    organizationId: string,
    input: CreateOrganizationGroupRequest,
  ) => Promise<OrganizationGroupSummaryResponse | null>;
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
  readonly currentOrgAdminUserIds: readonly string[];
  readonly memberGroupId: string;
}

export async function cacheGroupPolicy(input: {
  readonly acknowledgedMemberEnvelopes?:
    | CurrentPrincipalMemberEnvelopesResponse
    | undefined;
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
  readonly execSql: ExecSql;
  readonly expectedCurrentHead?: ReferencedPrincipalHead | undefined;
  readonly groupId: string;
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
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
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql: input.execSql,
    policies: [verified],
  });
  await savePrincipalPolicyBundle(
    input.execSql,
    bundle,
    new Date().toISOString(),
  );
  return bundle;
}

export async function loadGroupPolicyMutationContext(input: {
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<LoadedGroupPolicyMutationContext> {
  const currentPolicy = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!currentPolicy) {
    throw new Error("Group policy could not be loaded");
  }

  const verification = await prepareGroupPolicyVerification({
    currentPolicy,
    execSql: input.execSql,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  const adminPolicy = await loadOrganizationExternalAdminPolicy({
    execSql: input.execSql,
    getCurrentPrincipalPolicy: (principalType, principalId) =>
      principalType === "group" && principalId === input.groupId
        ? Promise.resolve(currentPolicy)
        : input.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if (!adminPolicy) {
    throw new Error("Organization admin authority could not be verified");
  }
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
    updatedAt: new Date().toISOString(),
  });

  return {
    adminGroupId: adminPolicy.adminGroupId,
    currentPolicy,
    currentOrgAdminUserIds,
    externalAuthority,
    isOrganizationAdminsGroup,
    memberGroupId: adminPolicy.memberGroupId,
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
  readonly request: PutPrincipalPolicyRequest;
}): Promise<PrincipalPolicyMutationResponse> {
  const storedPolicy = await input.apiClient.putPrincipalPolicy(
    "group",
    input.groupId,
    input.request,
  );

  if (!storedPolicy) {
    throw new Error("Group policy update failed");
  }
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
  await retainLocallyAcknowledgedPrincipalPolicyBundle({
    bundle: storedPolicy,
    execSql: input.execSql,
    policy: acknowledgedPolicy,
    updatedAt: new Date().toISOString(),
  });
  return storedPolicy;
}
