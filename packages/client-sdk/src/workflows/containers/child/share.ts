import type {
  ContainerAccessLevel,
  ContainerDirectGrant,
  ContainerGrantAccessEventBody,
  ContainerKekRecipientTarget,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
} from "@tearleads/crypto";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { signContainerMutationEvent } from "../../../data/containers/shared/events";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import {
  asContainerManifestBundle,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
  wrapContainerKeyToManagedPrincipal,
  wrapContainerKeyToRootUser,
} from "../../../data/containers/shared/projection";
import { readContainerKeyWraps } from "../../../data/containers/shared/readers";
import type {
  ContainerMutationAuthor,
  ContainerShareApi,
  ContainerSharePlan,
  MaterializedContainerSharePlan,
} from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import {
  type PrincipalPolicyCache,
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
import { submitAcknowledgedContainerMutation } from "./mutationSubmit";
import { requireUnwrappedKek } from "./rotationContext";
import {
  buildContainerSharePlanResult,
  type ContainerShareRecipient,
  collectContainerSharePrincipalPolicies,
  collectShareUserRecipientKeys,
  deriveContainerShareManifest,
  referencedPrincipalHeadFromPolicy,
  replaceContainerWrap,
  shareManifestHistory,
} from "./sharePlanCore";
import {
  advanceVerifiedSharePolicies,
  type ContainerManagedPrincipalShareApi,
  loadVerifiedGroupSharePrincipalPolicy,
} from "./sharePrincipalPolicy";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Container share planning keeps the cryptographic transition in one auditable sequence.
export async function buildMaterializedContainerSharePlan(input: {
  accessLevel: ContainerAccessLevel;
  author: ContainerMutationAuthor;
  eventId?: string | undefined;
  execSql: ExecSql;
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  principalPolicyCache?: PrincipalPolicyCache | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  recipient: ContainerShareRecipient;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<MaterializedContainerSharePlan> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    principalPolicyCache: input.principalPolicyCache,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const target = getTargetContainerContext(input.previousProjection);
  const previousState = readContainerState(target.manifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error("Container share author organization mismatch");
  }

  const grant: ContainerDirectGrant = {
    accessLevel: input.accessLevel,
    subjectId: input.recipient.subjectId,
    subjectType: input.recipient.subjectType,
  };
  const referencedPrincipalHead =
    input.recipient.subjectType === "user"
      ? null
      : referencedPrincipalHeadFromPolicy(input.recipient.principalPolicy);
  const body: ContainerGrantAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previousState.containerKeyEpochId,
    grant,
    referencedPrincipalHead,
  };
  const { event, eventHash } = await signContainerMutationEvent({
    author: input.author,
    body,
    containerId: previousState.containerId,
    dependencyManifestHashes: uniqueSortedManifestHashes(
      input.previousProjection.path,
    ),
    eventId: input.eventId ?? crypto.randomUUID(),
    previousManifestHash: target.manifest.manifestHash,
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } = await deriveContainerShareManifest({
    eventHash,
    grant,
    previousManifest: target.manifest,
    referencedPrincipalHead,
  });
  const containerKey = requireUnwrappedKek(
    keksByEpochId,
    target.kek,
    "Container share target",
  );
  let recipientTarget: ContainerKekRecipientTarget;
  let userRecipientKeys: ContainerUserRecipientKey[];
  let wrap: ContainerKeyWrap;
  if (input.recipient.subjectType === "user") {
    const shareRecipient = await wrapContainerKeyToRootUser({
      containerKey,
      containerKeyEpochId: target.kek.containerKeyEpochId,
      manifestHash,
      recipientEncapsulationPublicKey:
        input.recipient.recipientEncapsulationPublicKey,
      userId: input.recipient.subjectId,
    });
    recipientTarget = shareRecipient.recipientTarget;
    userRecipientKeys = collectShareUserRecipientKeys({
      newUserRecipientKey: shareRecipient.userRecipientKey,
      state,
      targetKek: target.kek,
    });
    wrap = shareRecipient.wrap;
  } else {
    const shareRecipient = await wrapContainerKeyToManagedPrincipal({
      containerKey,
      containerKeyEpochId: target.kek.containerKeyEpochId,
      manifestHash,
      principalEncapsulationPublicKey:
        input.recipient.principalPolicy.state.encapsulationPublicKey,
      principalHead: referencedPrincipalHeadFromPolicy(
        input.recipient.principalPolicy,
      ),
    });
    recipientTarget = shareRecipient.recipientTarget;
    userRecipientKeys = collectShareUserRecipientKeys({
      state,
      targetKek: target.kek,
    });
    wrap = shareRecipient.wrap;
  }
  const previousWraps = readContainerKeyWraps(
    target.kek.wraps,
    "Container share previous wraps",
  );
  const principalPolicies = await collectContainerSharePrincipalPolicies({
    execSql: input.execSql,
    principalPolicyCache: input.principalPolicyCache,
    previousProjection: input.previousProjection,
    ...(input.recipient.subjectType === "user"
      ? {}
      : { recipientPolicy: input.recipient.principalPolicy }),
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });

  return buildContainerSharePlanResult({
    body,
    containerManifestHistory: shareManifestHistory({
      containerId: previousState.containerId,
      targetKek: target.kek,
      targetManifest: target.manifest,
    }),
    containerKey,
    containerId: previousState.containerId,
    event,
    eventHash,
    grant,
    manifest,
    manifestHash,
    previousManifest: asContainerManifestBundle(target.manifest),
    previousProjection: input.previousProjection,
    principalPolicies,
    recipientTarget,
    state,
    targetKek: target.kek,
    userRecipientKeys,
    wraps: replaceContainerWrap(previousWraps, wrap),
  });
}

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

export async function shareRemoteContainerWithGroup(input: {
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
  );

  return {
    containerKey: materializedPlan.containerKey,
    plan: materializedPlan.plan,
    response,
  };
}
