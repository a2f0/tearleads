import type { ContainerAccessLevel, SigningKeyPair } from "@tearleads/crypto";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import type {
  ContainerMutationAuthor,
  ContainerShareApi,
  ContainerSharePlan,
  MaterializedContainerSharePlan,
} from "../../../data/containers/shared/types";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "../../../data/keyingProjectionVerification/principalPolicyCache";
import { savePrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../../data/trustedUserIdentity";
import { preparePrincipalContainerRematerializationBatch } from "../../organizations/principalContainerRematerialization";
import { setOrganizationGroupContainerGrant } from "../../organizations/principalPolicy";
import { submitAcknowledgedContainerMutation } from "./mutationSubmit";
import { buildMaterializedContainerSharePlan } from "./shareMaterialization";
import {
  advanceVerifiedSharePolicies,
  type ContainerManagedPrincipalShareApi,
  loadVerifiedGroupSharePrincipalPolicy,
} from "./sharePrincipalPolicy";

export async function shareRemoteContainer(input: {
  accessLevel: ContainerAccessLevel;
  apiClient: ContainerShareApi;
  author: ContainerMutationAuthor;
  containerId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  previousProjection?: ContainerWriterProjectionResponse | undefined;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
  response: ContainerMutationResponse;
} | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container share",
  );
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    input.resolveTrustedUserIdentity,
  );
  const recipientIdentity = await resolveTrustedUserIdentity(
    input.recipientUserId,
  );
  if (!recipientIdentity) {
    return null;
  }
  const previousProjection =
    input.previousProjection ??
    (await input.apiClient.getContainerWriterProjection(input.containerId));
  if (!previousProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerSharePlan({
    accessLevel: input.accessLevel,
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    previousProjection,
    recipient: {
      recipientEncapsulationPublicKey: recipientIdentity.encapsulationPublicKey,
      subjectId: input.recipientUserId,
      subjectType: "user",
    },
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return submitAcknowledgedContainerMutation({
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    plan: materializedPlan.plan,
    submit: () =>
      input.apiClient.shareContainer(
        input.containerId,
        materializedPlan.plan.request,
      ),
  });
}

interface RemoteContainerGroupShareInput {
  accessLevel: ContainerAccessLevel;
  apiClient: ContainerManagedPrincipalShareApi;
  author: ContainerMutationAuthor;
  containerId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  previousProjection?: ContainerWriterProjectionResponse | undefined;
  recipientGroupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  signedAt?: string | undefined;
  signingKeyPair?: SigningKeyPair | null | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

interface RemoteContainerGroupShareResult {
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
  response: ContainerMutationResponse;
}

function isMaterializedContainerSharePlan(
  value: Awaited<
    ReturnType<typeof preparePrincipalContainerRematerializationBatch>
  >["plans"][number],
): value is MaterializedContainerSharePlan {
  return value.plan.body.eventType === "container.grant";
}

async function commitMissingGroupGrant(
  input: RemoteContainerGroupShareInput,
): Promise<RemoteContainerGroupShareResult> {
  if (!input.signingKeyPair) {
    throw new Error(
      "Container group share requires principal policy signing context",
    );
  }
  const policyApi = {
    commitOrganizationGroupPolicy:
      input.apiClient.commitOrganizationGroupPolicy.bind(input.apiClient),
    getCurrentPrincipalPolicy: input.apiClient.getCurrentPrincipalPolicy.bind(
      input.apiClient,
    ),
  };
  let preparedTarget:
    | Awaited<
        ReturnType<typeof preparePrincipalContainerRematerializationBatch>
      >
    | undefined;
  const storedPolicy = await setOrganizationGroupContainerGrant({
    accessLevel: input.accessLevel,
    apiClient: policyApi,
    containerId: input.containerId,
    execSql: input.execSql,
    groupId: input.recipientGroupId,
    organizationId: input.author.organizationId,
    prepareContainerMutations: async ({ currentPolicy, nextPolicy }) => {
      const prepared = await preparePrincipalContainerRematerializationBatch({
        apiClient: input.apiClient,
        author: input.author,
        execSql: input.execSql,
        grants: [
          ...new Map(
            [...currentPolicy.currentGrants, ...nextPolicy.grants].map(
              (grant) => [grant.containerId, grant] as const,
            ),
          ).values(),
        ],
        groupId: input.recipientGroupId,
        nextPolicy,
        resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      });
      preparedTarget = prepared;
      return prepared;
    },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    signerUserId: input.author.signerUserId,
    signingFingerprint: input.author.signerKeyFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const targetIndex = preparedTarget?.plans.findIndex(
    (planned) => planned.plan.containerId === input.containerId,
  );
  const response =
    targetIndex === undefined || targetIndex < 0
      ? undefined
      : storedPolicy.containerMutations[targetIndex];
  const targetPlan =
    targetIndex === undefined || targetIndex < 0
      ? undefined
      : preparedTarget?.plans[targetIndex];
  if (
    !targetPlan ||
    !response ||
    !isMaterializedContainerSharePlan(targetPlan)
  ) {
    throw new Error("Container group share acknowledgement is incomplete");
  }
  return {
    containerKey: targetPlan.containerKey,
    plan: targetPlan.plan,
    response,
  };
}

export async function shareRemoteContainerWithGroup(
  input: RemoteContainerGroupShareInput,
): Promise<RemoteContainerGroupShareResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container share",
  );
  const previousProjection =
    input.previousProjection ??
    (await input.apiClient.getContainerWriterProjection(input.containerId));
  if (!previousProjection) {
    return null;
  }
  const verifiedPrincipalPolicy = await loadVerifiedGroupSharePrincipalPolicy({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.recipientGroupId,
    organizationId: input.author.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  await advanceVerifiedSharePolicies(input.execSql, verifiedPrincipalPolicy);

  const signedGrant = verifiedPrincipalPolicy.policy.grants.find(
    (grant) => grant.containerId === input.containerId,
  );
  if (!signedGrant || signedGrant.accessLevel !== input.accessLevel) {
    return commitMissingGroupGrant(input);
  }

  const materializedPlan = await buildMaterializedContainerSharePlan({
    accessLevel: input.accessLevel,
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    principalPolicyCache: principalPolicyCacheForVerifiedPolicies(
      verifiedPrincipalPolicy.checkpointPolicies,
    ),
    previousProjection,
    recipient: {
      principalPolicy: verifiedPrincipalPolicy.policy,
      subjectId: input.recipientGroupId,
      subjectType: "group",
    },
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const response = await input.apiClient.shareContainer(
    input.containerId,
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }

  await acknowledgeContainerMutation({
    execSql: input.execSql,
    plan: materializedPlan.plan,
    response,
  });

  // Keep the previously cached group epoch available until the old container
  // wrap has been unwrapped and the replacement has committed. Root has no
  // parent fallback, so caching the rotated policy any earlier destroys the
  // only local path to the KEK that must be re-wrapped.
  await savePrincipalPolicyBundle(
    input.execSql,
    verifiedPrincipalPolicy.bundle,
    new Date().toISOString(),
    input.author.organizationId,
  );

  return {
    containerKey: materializedPlan.containerKey,
    plan: materializedPlan.plan,
    response,
  };
}
