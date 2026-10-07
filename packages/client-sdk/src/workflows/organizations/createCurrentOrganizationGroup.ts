import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import type { createGroupMetadataAccess } from "./groupMetadataAccess";
import { assertGroupMetadataBinding } from "./groupMetadataBinding";
import { readDirectoryGroupName } from "./groupNameUniqueness";
import { acknowledgeInitialGroupPolicy } from "./groupPolicyMutationAcknowledgement";
import type { OrganizationPrincipalPolicyApi } from "./groupPolicyMutationContext";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "./organizationGroupDirectory";
import {
  buildInitialGroupPolicyRequest,
  canonicalGroupNameKey,
} from "./principalPolicyRequest";
import type { OrganizationGroupSummary } from "./readModel";
import type { CurrentOrganizationMutationContext } from "./runtimeCurrentOrganizationMutation";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "./trustedOrganizationUsers";

/** Create from bounded current evidence and publish its genuine genesis with the directory. */
export async function createCurrentOrganizationGroup(input: {
  readonly apiClient: Pick<
    OrganizationPrincipalPolicyApi,
    "createOrganizationGroup"
  >;
  readonly context: CurrentOrganizationMutationContext;
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
}): Promise<OrganizationGroupSummary> {
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
    await advanceKeyingCheckpointsAtomically({
      execSql: input.execSql,
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
  // Genesis really has one signed state. Reconstruct only the exact authored
  // artifacts whose commitments match the summary, then verify them privately.
  const { bundle } = await acknowledgeInitialGroupPolicy({
    organizationId: input.organizationId,
    request,
    response: stored.group,
    stateHash: head.stateHash,
  });
  const { previousStates: _previousStates, ...current } = bundle;
  await context.retainCreatedGroup({
    request: request.initialGroupPolicy,
    response: { ...current, containerMutations: [] },
    organizationRequest,
    organizationResponse: stored.organizationPolicy,
  });
  assertProjectionVerificationCurrent(context.stillCurrent);
  return { ...stored.group, name: input.name.trim(), nameUnreadable: false };
}
