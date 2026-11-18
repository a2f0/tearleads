import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import {
  committedReadModelDelta,
  type OrganizationReadModelDeltaResponse,
} from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { principalPolicyReferenceFromBundle } from "../../../data/principalContracts/principalPolicyAdminSigners";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../../../data/principals/organizationGroupDirectoryRequest";
import {
  buildInitialGroupPolicyRequest,
  canonicalGroupNameKey,
} from "../../../data/principals/principalPolicyRequest";
import type { SecurityIncidentReporter } from "../../../data/shared/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import type { createGroupMetadataAccess } from "../groupMetadata/groupMetadataAccess";
import { assertGroupMetadataBinding } from "../groupMetadata/groupMetadataBinding";
import { readDirectoryGroupName } from "../groupNames/groupNameUniqueness";
import { acknowledgeInitialGroupPolicy } from "../groupPolicy/groupPolicyMutationAcknowledgement";
import type { OrganizationPrincipalPolicyApi } from "../groupPolicy/groupPolicyMutationContext";
import { groupPolicyMutationHead } from "../groupPolicy/groupPolicyMutationHead";
import type { CurrentOrganizationMutationContext } from "../principalMutations/runtimeCurrentOrganizationMutation";
import type { OrganizationGroupSummary } from "../readModel";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "../trustedOrganizationUsers";

/** The created group, with the read-model delta its create response carried. */
export type CreatedCurrentOrganizationGroup = OrganizationGroupSummary & {
  readonly readModel?: OrganizationReadModelDeltaResponse | undefined;
};

/** Create from bounded current evidence and publish its genuine genesis with the directory. */
export async function createCurrentOrganizationGroup(input: {
  readonly apiClient: Pick<
    OrganizationPrincipalPolicyApi,
    "createOrganizationGroup"
  >;
  readonly context: CurrentOrganizationMutationContext;
  readonly identityTrustDomain: string;
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly execSql: ExecSql;
  readonly metadataAccess: ReturnType<typeof createGroupMetadataAccess>;
  readonly name: string;
  readonly organizationId: string;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<CreatedCurrentOrganizationGroup> {
  const { context } = input;
  assertProjectionVerificationCurrent(context.stillCurrent);
  const nameKey = canonicalGroupNameKey(input.name);
  // Each current recovery is queued by organization. Retain verified heads one
  // at a time so the walk stays bounded without collecting full group histories.
  for (const head of context.descriptor.groupHeads) {
    const group = await context.readGroup(head.principalId);
    const stillCurrent = () => context.stillCurrent() && group.stillCurrent();
    assertProjectionVerificationCurrent(stillCurrent);
    assertGroupMetadataBinding(group.current, context.descriptor);
    const name = await readDirectoryGroupName(
      { ...input, readEncryptedName: input.metadataAccess.readName },
      group.current,
    );
    // Remember independently verified heads even if uniqueness or dispatch
    // later fails; these are observed policies, never speculative successors.
    await new KeyingCheckpointRepository(
      input.execSql,
    ).advanceKeyingCheckpointsAtomically({
      organizationId: input.organizationId,
      access: [],
      policies: [...group.dependencies, group.policy],
      stillCurrent,
    });
    if (name !== null && canonicalGroupNameKey(name) === nameKey)
      throw new Error(
        "Another signed group in this organization already carries this name",
      );
  }
  const request = await buildInitialGroupPolicyRequest({
    ...input,
    groupId: crypto.randomUUID(),
    includeSignerAsAdmin: false,
    externalAuthority: {
      ...principalPolicyReferenceFromBundle(context.admins.current),
      principalType: "group",
    },
    metadataKey: await input.metadataAccess.loadEncryptionKey(),
  });
  const head = await groupPolicyMutationHead(request.initialGroupPolicy);
  const adminProjection = context.admins.policy.projection;
  const organizationRequest =
    await buildOrganizationGroupDirectoryPolicyRequest({
      ...input,
      currentPolicy: context.directory.current,
      // Creating a group keeps the admins; the creator's key checks that its
      // envelope still opens the kept directory key.
      currentUserSecretKey: input.creatorEncapsulationKeyPair.secretKey,
      descriptor: context.descriptor,
      groupHeads: replaceOrganizationGroupHead({
        descriptor: context.descriptor,
        nextHead: head,
      }),
      adminProjection,
      adminUsers: await resolveRequiredUserIdentities({
        resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
        userIds: projectionUserIds(adminProjection),
      }),
    });
  assertProjectionVerificationCurrent(context.stillCurrent);
  const stored = await input.apiClient.createOrganizationGroup(
    input.organizationId,
    { ...request, organizationPolicy: organizationRequest },
  );
  assertProjectionVerificationCurrent(context.stillCurrent);
  if (!stored) throw new Error("Group could not be created");
  // Genesis really has one signed state. Its acknowledgement is the summary;
  // the retained current is rebuilt from the exact authored request.
  await acknowledgeInitialGroupPolicy({
    organizationId: input.organizationId,
    request,
    response: stored.group,
    stateHash: head.stateHash,
  });
  await context.retainCreatedGroup({
    request: request.initialGroupPolicy,
    response: {
      head,
      createdAt: stored.group.createdAt,
      containerMutations: [],
    },
    organizationRequest,
    organizationResponse: stored.organizationPolicy,
  });
  assertProjectionVerificationCurrent(context.stillCurrent);
  const created = {
    ...stored.group,
    name: input.name.trim(),
    nameUnreadable: false,
  };
  const readModel = committedReadModelDelta(
    stored.readModel,
    input.organizationId,
  );
  return readModel ? { ...created, readModel } : created;
}
