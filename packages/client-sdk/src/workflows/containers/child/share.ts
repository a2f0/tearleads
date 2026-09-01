import type {
  ContainerAccessLevel,
  SigningKeyPair,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
} from "@symcrypt/validators/response";
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

class ContainerShareGenerationExpiredError extends Error {}

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
  stillCurrent?: (() => boolean) | undefined;
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
  if (!recipientIdentity || input.stillCurrent?.() === false) {
    return null;
  }
  const previousProjection =
    input.previousProjection ??
    (await input.apiClient.getContainerWriterProjection(input.containerId));
  if (!previousProjection || input.stillCurrent?.() === false) {
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
    stillCurrent: input.stillCurrent,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return submitAcknowledgedContainerMutation({
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    plan: materializedPlan.plan,
    stillCurrent: input.stillCurrent,
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
  stillCurrent?: (() => boolean) | undefined;
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

async function prepareMissingGroupGrantMutations(input: {
  currentPolicy: PrincipalPolicyBundleResponse;
  nextPolicy: VerifiedPrincipalPolicy;
  shareInput: RemoteContainerGroupShareInput;
}) {
  const { currentPolicy, nextPolicy, shareInput } = input;
  return preparePrincipalContainerRematerializationBatch({
    apiClient: shareInput.apiClient,
    author: shareInput.author,
    execSql: shareInput.execSql,
    grants: [
      ...new Map(
        [...currentPolicy.currentGrants, ...nextPolicy.grants].map(
          (grant) => [grant.containerId, grant] as const,
        ),
      ).values(),
    ],
    groupId: shareInput.recipientGroupId,
    nextPolicy,
    resolveTrustedUserIdentity: shareInput.resolveTrustedUserIdentity,
    stillCurrent: shareInput.stillCurrent,
    targetSecretKey: shareInput.targetSecretKey,
    warmReferencedPrincipalPolicies: shareInput.warmReferencedPrincipalPolicies,
  });
}

async function commitMissingGroupGrantPolicy(
  input: RemoteContainerGroupShareInput,
): Promise<{
  preparedTarget: Awaited<
    ReturnType<typeof preparePrincipalContainerRematerializationBatch>
  >;
  storedPolicy: Awaited<ReturnType<typeof setOrganizationGroupContainerGrant>>;
} | null> {
  const signingKeyPair = input.signingKeyPair;
  if (!signingKeyPair) {
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
  try {
    const storedPolicy = await setOrganizationGroupContainerGrant({
      accessLevel: input.accessLevel,
      apiClient: policyApi,
      assertCanCommit: () => {
        if (input.stillCurrent?.() === false) {
          throw new ContainerShareGenerationExpiredError();
        }
      },
      containerId: input.containerId,
      execSql: input.execSql,
      groupId: input.recipientGroupId,
      organizationId: input.author.organizationId,
      prepareContainerMutations: async ({ currentPolicy, nextPolicy }) => {
        preparedTarget = await prepareMissingGroupGrantMutations({
          currentPolicy,
          nextPolicy,
          shareInput: input,
        });
        return preparedTarget;
      },
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
      signerUserId: input.author.signerUserId,
      signingFingerprint: input.author.signerKeyFingerprint,
      signingKeyPair,
    });
    if (!preparedTarget) {
      throw new Error("Container group share preparation is incomplete");
    }
    return { preparedTarget, storedPolicy };
  } catch (error) {
    if (error instanceof ContainerShareGenerationExpiredError) return null;
    throw error;
  }
}

async function commitMissingGroupGrant(
  input: RemoteContainerGroupShareInput,
): Promise<RemoteContainerGroupShareResult | null> {
  if (!input.signingKeyPair) {
    throw new Error(
      "Container group share requires principal policy signing context",
    );
  }
  if (input.stillCurrent?.() === false) return null;
  const committed = await commitMissingGroupGrantPolicy(input);
  if (!committed) return null;
  const { preparedTarget, storedPolicy } = committed;
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
  if (input.stillCurrent?.() === false) return null;
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container share",
  );
  const previousProjection =
    input.previousProjection ??
    (await input.apiClient.getContainerWriterProjection(input.containerId));
  if (!previousProjection || input.stillCurrent?.() === false) {
    return null;
  }
  const verifiedPrincipalPolicy = await loadVerifiedGroupSharePrincipalPolicy({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.recipientGroupId,
    organizationId: input.author.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if (input.stillCurrent?.() === false) return null;
  await advanceVerifiedSharePolicies(
    input.execSql,
    verifiedPrincipalPolicy,
    input.stillCurrent,
  );
  if (input.stillCurrent?.() === false) return null;

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
    stillCurrent: input.stillCurrent,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  if (input.stillCurrent?.() === false) return null;
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
    stillCurrent: input.stillCurrent,
  });

  // Keep the previously cached group epoch available until the old container
  // wrap has been unwrapped and the replacement has committed. Root has no
  // parent fallback, so caching the rotated policy any earlier destroys the
  // only local path to the KEK that must be re-wrapped.
  if (input.stillCurrent?.() !== false) {
    await savePrincipalPolicyBundle(
      input.execSql,
      verifiedPrincipalPolicy.bundle,
      new Date().toISOString(),
      input.author.organizationId,
      { stillCurrent: input.stillCurrent },
    );
  }
  if (input.stillCurrent?.() === false) return null;

  return {
    containerKey: materializedPlan.containerKey,
    plan: materializedPlan.plan,
    response,
  };
}
