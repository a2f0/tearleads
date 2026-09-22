import type {
  PrincipalPolicyCheckpoint,
  PrincipalPolicyExternalAuthority,
  PrincipalPolicySignerPublicKey,
  ReferencedPrincipalHead,
  SigningKeyPair,
} from "@tearleads/crypto";
import type {
  CommitOrganizationGroupPolicyRequest,
  ContainerMutationRequest,
  CreateOrganizationGroupWithPolicyRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  type CommitOrganizationGroupPolicyResponse,
  type CreateOrganizationGroupResponse,
  type CurrentPrincipalMemberEnvelopesResponse,
  type PrincipalPolicyBundleResponse,
  type PrincipalPolicyMutationResponse,
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
import { assertGroupMetadataBinding } from "./groupMetadataBinding";
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
  /**
   * Optional status-bearing variant. A rematerialized rotation the server
   * refuses for stranding a granted path names the descendant rekeys the batch
   * must carry; without this the refusal is a plain failure.
   */
  commitOrganizationGroupPolicyResult?: (
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
    options?: { readonly reportErrors?: boolean | undefined },
  ) => Promise<
    | {
        readonly ok: true;
        readonly data: CommitOrganizationGroupPolicyResponse;
      }
    | {
        readonly ok: false;
        readonly code?: string | undefined;
        readonly report?: (() => void) | undefined;
        readonly requiredContainerIds?: readonly string[] | undefined;
        readonly status: number | null;
      }
  >;
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

/**
 * Commit, answering one refusal: a rematerialized rekey or revoke that would
 * strand a level above a directly granted container is refused with the
 * descendant rekeys it must carry. The refused attempt rolled back whole, so
 * the signed batch still extends the current heads; the carried rekeys are
 * appended and the commit retried once. A second refusal means the tree moved
 * underneath, and the caller's own retry starts from a fresh policy.
 */
async function submitGroupPolicyCommit(input: {
  readonly apiClient: PrincipalPolicyReadWriteApi;
  readonly carryDescendantRekeys?:
    | ((
        requiredContainerIds: readonly string[],
      ) => Promise<readonly ContainerMutationRequest[]>)
    | undefined;
  readonly groupId: string;
  readonly organizationId: string;
  readonly organizationRequest: PutPrincipalPolicyRequest;
  readonly request: PutPrincipalPolicyRequest;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<CommitOrganizationGroupPolicyResponse | null> {
  const body = () => ({
    groupPolicy: input.request,
    organizationPolicy: input.organizationRequest,
  });
  const { commitOrganizationGroupPolicyResult } = input.apiClient;
  if (!commitOrganizationGroupPolicyResult || !input.carryDescendantRekeys) {
    return input.apiClient.commitOrganizationGroupPolicy(
      input.organizationId,
      input.groupId,
      body(),
    );
  }
  const first = await commitOrganizationGroupPolicyResult.call(
    input.apiClient,
    input.organizationId,
    input.groupId,
    body(),
    { reportErrors: false },
  );
  if (first.ok) return first.data;
  if (
    first.code !== CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired ||
    !first.requiredContainerIds?.length
  ) {
    first.report?.();
    return null;
  }
  const carried = await input.carryDescendantRekeys(first.requiredContainerIds);
  if (input.stillCurrent?.() === false) return null;
  // Nothing signed means the same refusal again; report the one already had.
  if (carried.length === 0) {
    first.report?.();
    return null;
  }
  input.request.containerMutations = [
    ...(input.request.containerMutations ?? []),
    ...carried,
  ];
  const second = await commitOrganizationGroupPolicyResult.call(
    input.apiClient,
    input.organizationId,
    input.groupId,
    body(),
    { reportErrors: false },
  );
  if (!second.ok) {
    second.report?.();
    return null;
  }
  return second.data;
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
  /**
   * Sign the descendant rekeys a refused batch must carry; they are appended
   * to `containerMutations` and the commit is retried once.
   */
  readonly carryDescendantRekeys?:
    | ((
        requiredContainerIds: readonly string[],
      ) => Promise<readonly ContainerMutationRequest[]>)
    | undefined;
  readonly request: PutPrincipalPolicyRequest;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<PrincipalPolicyMutationResponse> {
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
