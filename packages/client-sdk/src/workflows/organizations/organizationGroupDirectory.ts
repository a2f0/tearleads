import {
  buildPrincipalStateSigningInput,
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import type {
  PrincipalProjectionMemberRequest,
  PutPrincipalPolicyRequest,
} from "@symcrypt/validators/request";
import type {
  OrganizationGroupSummaryResponse,
  PrincipalPolicyBundleResponse,
} from "@symcrypt/validators/response";
import { persistLocallyAcknowledgedPrincipalPolicyBundles } from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import {
  encodeOrganizationAuthorityDescriptor,
  normalizeOrganizationGroupHeads,
  type OrganizationAuthorityDescriptor,
  type OrganizationGroupHead,
} from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type {
  TrustedUserIdentity,
  TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import type { loadOrganizationExternalAdminPolicy } from "../principals/externalAdminPolicy";
import {
  acknowledgeGroupPolicyState,
  acknowledgeInitialGroupPolicy,
  assertGroupPolicyBundleMatchesAcknowledgement,
} from "./groupPolicyMutationAcknowledgement";
import type { OrganizationPrincipalPolicyApi } from "./groupPolicyMutationContext";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import { rewrapProjectionMemberEnvelopes } from "./principalPolicyRecipients";
import type { buildInitialGroupPolicyRequest } from "./principalPolicyRequest";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "./trustedOrganizationUsers";

function organizationGroupHead(
  head: ReferencedPrincipalHead,
): OrganizationGroupHead {
  if (head.principalType !== "group") {
    throw new Error("Organization directory can contain only group heads");
  }
  return { ...head, principalType: "group" };
}

export function replaceOrganizationGroupHead(input: {
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly nextHead: ReferencedPrincipalHead;
}): OrganizationGroupHead[] {
  const nextHead = organizationGroupHead(input.nextHead);
  return normalizeOrganizationGroupHeads([
    ...input.descriptor.groupHeads.filter(
      (head) => head.principalId !== nextHead.principalId,
    ),
    nextHead,
  ]);
}

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

export async function buildOrganizationGroupDirectoryPolicyRequest(input: {
  readonly adminProjection: readonly PrincipalProjectionMemberRequest[];
  readonly adminUsers: readonly TrustedUserIdentity[];
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly groupHeads: readonly OrganizationGroupHead[];
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PutPrincipalPolicyRequest> {
  const projection = normalizePrincipalProjectionMembers(input.adminProjection);
  if (
    projection.length === 0 ||
    projection.some((member) => member.role !== "admin")
  ) {
    throw new Error("Organization policy must mirror the Admins projection");
  }
  const organizationKem = generateKemSeedAndKeyPair();
  const memberEnvelopes = await rewrapProjectionMemberEnvelopes({
    projection,
    secretKey: organizationKem.secretKey,
    users: input.adminUsers,
  });
  const payloadCiphertext = encodeOrganizationAuthorityDescriptor({
    ...input.descriptor,
    groupHeads: input.groupHeads,
  });
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "organization",
      principalId: input.descriptor.organizationId,
      version: input.currentPolicy.currentState.version + 1,
      prevStateHash: input.currentPolicy.currentState.stateHash,
      keyEpoch: input.currentPolicy.currentState.keyEpoch + 1,
      encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
      keyFingerprint: await toFingerprint(organizationKem.publicKey),
      members: projection.map((member) => ({ userId: member.userId })),
      memberEnvelopes,
      projection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: new Date().toISOString(),
      signerUserId: input.signerUserId,
      signerUserKeyFingerprint: input.signingFingerprint,
    }),
    input.signingKeyPair.signingPrivateKey,
  );

  return {
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    grants: [],
    memberEnvelopes,
    projection,
    state,
  };
}

export async function commitCreatedGroupToDirectory(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly externalAdminPolicy: NonNullable<
    Awaited<ReturnType<typeof loadOrganizationExternalAdminPolicy>>
  >;
  readonly organizationId: string;
  readonly request: Awaited<ReturnType<typeof buildInitialGroupPolicyRequest>>;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<{
  readonly group: OrganizationGroupSummaryResponse;
  readonly head: ReferencedPrincipalHead;
}> {
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
  const stored = await input.apiClient.createOrganizationGroup(
    input.organizationId,
    { ...input.request, organizationPolicy: organizationRequest },
  );
  if (!stored) {
    throw new Error("Group could not be created");
  }
  const acknowledged = await acknowledgeInitialGroupPolicy({
    organizationId: input.organizationId,
    request: input.request,
    response: stored.group,
    stateHash: expectedHead.stateHash,
  });
  const organizationHead = await groupPolicyMutationHead(organizationRequest);
  const organizationPolicy = await acknowledgeGroupPolicyState({
    currentPolicy: input.externalAdminPolicy.bundle,
    expectedHead: organizationHead,
    request: organizationRequest,
    response: stored.organizationPolicy.currentState,
  });
  assertGroupPolicyBundleMatchesAcknowledgement({
    currentPolicy: input.externalAdminPolicy.bundle,
    expectedHead: organizationHead,
    request: organizationRequest,
    response: stored.organizationPolicy,
  });
  await persistLocallyAcknowledgedPrincipalPolicyBundles({
    entries: [
      { bundle: acknowledged.bundle, policy: acknowledged.policy },
      { bundle: stored.organizationPolicy, policy: organizationPolicy },
    ],
    execSql: input.execSql,
    organizationId: input.organizationId,
    updatedAt: new Date().toISOString(),
  });
  return { group: stored.group, head: expectedHead };
}
