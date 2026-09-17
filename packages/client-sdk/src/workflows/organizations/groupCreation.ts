import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { loadOrganizationExternalAdminPolicy } from "../principals/externalAdminPolicy";
import type { createGroupMetadataAccess } from "./groupMetadataAccess";
import {
  cacheGroupPolicy,
  type OrganizationPrincipalPolicyApi,
} from "./groupPolicyMutationContext";
import { commitCreatedGroupToDirectory } from "./organizationGroupDirectory";
import { buildInitialGroupPolicyRequest } from "./principalPolicyRequest";
import type { OrganizationGroupSummary } from "./readModel";

export async function createOrganizationGroup(input: {
  readonly metadataAccess: ReturnType<typeof createGroupMetadataAccess>;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly execSql: ExecSql;
  readonly name: string;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<OrganizationGroupSummary> {
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
    metadataKey: await input.metadataAccess.loadEncryptionKey(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const { group, head: expectedHead } = await commitCreatedGroupToDirectory({
    ...input,
    externalAdminPolicy,
    readEncryptedName: input.metadataAccess.readName,
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
  return { ...group, name: input.name.trim() };
}
