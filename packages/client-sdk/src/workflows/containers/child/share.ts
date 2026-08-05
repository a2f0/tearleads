import {
  type AccessEvent,
  type AccessManifest,
  type ContainerAccessLevel,
  type ContainerAccessManifestState,
  type ContainerDirectGrant,
  type ContainerGrantAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  type ManagedPrincipalKind,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { signContainerMutationEvent } from "../../../data/containers/shared/events";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import {
  principalPolicyRequestRecord,
  uniquePrincipalPolicies,
} from "../../../data/containers/shared/principalPolicies";
import {
  asContainerManifestBundle,
  getParentKekForTarget,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
  wrapContainerKeyToManagedPrincipal,
  wrapContainerKeyToRootUser,
} from "../../../data/containers/shared/projection";
import {
  readContainerKekRecipientTargets,
  readContainerKeyEpoch,
  readContainerKeyWraps,
} from "../../../data/containers/shared/readers";
import type {
  ContainerMutationAuthor,
  ContainerShareApi,
  ContainerSharePlan,
  MaterializedContainerSharePlan,
} from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type PrincipalPolicyCache,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "../../../data/keyingProjectionVerification/principalPolicyCache";
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpointAdvancePersistence";
import { savePrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../../data/trustedUserIdentity";
import {
  type ContainerManagedPrincipalShareApi,
  loadVerifiedGroupSharePrincipalPolicy,
} from "./sharePrincipalPolicy";

type ContainerShareRecipient =
  | {
      readonly recipientEncapsulationPublicKey: Uint8Array;
      readonly subjectId: string;
      readonly subjectType: "user";
    }
  | {
      readonly principalPolicy: VerifiedPrincipalPolicy;
      readonly subjectId: string;
      readonly subjectType: ManagedPrincipalKind;
    };

function grantKey(
  grant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

function upsertContainerGrant(
  grants: readonly ContainerDirectGrant[],
  grant: ContainerDirectGrant,
): ContainerDirectGrant[] {
  return [
    ...grants.filter(
      (existingGrant) => grantKey(existingGrant) !== grantKey(grant),
    ),
    grant,
  ].sort((left, right) => grantKey(left).localeCompare(grantKey(right)));
}

function referencedPrincipalKey(reference: {
  readonly principalId: string;
  readonly principalType: ManagedPrincipalKind;
}): string {
  return `${reference.principalType}:${reference.principalId}`;
}

function referencedPrincipalHeadFromPolicy(
  policy: VerifiedPrincipalPolicy,
): ReferencedPrincipalHead {
  return {
    principalType: policy.principalType,
    principalId: policy.principalId,
    version: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash: policy.stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  };
}

function upsertReferencedPrincipalHead(
  references: readonly ReferencedPrincipalHead[],
  reference: ReferencedPrincipalHead,
): ReferencedPrincipalHead[] {
  return [
    ...references.filter(
      (existingReference) =>
        referencedPrincipalKey(existingReference) !==
        referencedPrincipalKey(reference),
    ),
    reference,
  ].sort((left, right) =>
    referencedPrincipalKey(left).localeCompare(referencedPrincipalKey(right)),
  );
}

async function deriveContainerShareManifest(input: {
  eventHash: string;
  grant: ContainerDirectGrant;
  previousManifest: ContainerWriterProjectionResponse["path"][number];
  referencedPrincipalHead: ReferencedPrincipalHead | null;
}): Promise<Pick<ContainerSharePlan, "manifest" | "manifestHash" | "state">> {
  const previousState = readContainerState(input.previousManifest);
  const state: ContainerAccessManifestState = {
    ...previousState,
    epoch: previousState.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash: input.eventHash,
    directGrants: upsertContainerGrant(previousState.directGrants, input.grant),
    referencedPrincipalHeads: input.referencedPrincipalHead
      ? upsertReferencedPrincipalHead(
          previousState.referencedPrincipalHeads,
          input.referencedPrincipalHead,
        )
      : previousState.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

function buildContainerShareRequest(input: {
  body: ContainerGrantAccessEventBody;
  containerManifestHistory: readonly AccessManifestBundleWire[];
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse | null;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    event: readCanonicalRecord(input.event, "Container share event"),
    body: readCanonicalRecord(input.body, "Container share body"),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(input.manifest, "Container share manifest"),
    previousManifest: input.previousManifest,
    previousContainerPath: input.previousProjection.path.map(
      asContainerManifestBundle,
    ),
    containerManifestHistory: [...input.containerManifestHistory],
    principalPolicies: readCanonicalRecords(
      input.principalPolicies.map((policy) =>
        principalPolicyRequestRecord(policy),
      ),
      "Container share principal policies",
    ),
    keyEpoch: readCanonicalRecord(input.keyEpoch, "Container share key epoch"),
    predecessorBridge: null,
    keyring: null,
    wraps: readCanonicalRecords(input.wraps, "Container share wraps"),
    parentKekState:
      input.parentKek === null
        ? null
        : readCanonicalRecord(
            input.parentKek,
            "Container share parent KEK state",
          ),
    userRecipientKeys: readCanonicalRecords(
      input.userRecipientKeys,
      "Container share user recipient keys",
    ),
  };
}

function replaceContainerWrap(
  wraps: readonly ContainerKeyWrap[],
  nextWrap: ContainerKeyWrap,
): ContainerKeyWrap[] {
  return [
    ...wraps.filter(
      (wrap) =>
        !(
          wrap.recipientKind === nextWrap.recipientKind &&
          wrap.recipientId === nextWrap.recipientId
        ),
    ),
    nextWrap,
  ];
}

function shareManifestHistory(input: {
  readonly containerId: string;
  readonly targetKek: ContainerKekResponse;
  readonly targetManifest: ContainerWriterProjectionResponse["path"][number];
}): AccessManifestBundleWire[] {
  const byHash = new Map<string, AccessManifestBundleWire>();
  for (const bundle of [
    input.targetManifest,
    ...input.targetKek.containerManifestHistory,
  ]) {
    if (
      readContainerState(bundle).containerId === input.containerId &&
      !byHash.has(bundle.manifestHash)
    ) {
      byHash.set(bundle.manifestHash, asContainerManifestBundle(bundle));
    }
  }
  return [...byHash.values()];
}

function readCanonicalRecordOrNull(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  return value === null || value === undefined
    ? null
    : readCanonicalRecord(value, label);
}

function buildContainerSharePlanResult(input: {
  body: ContainerGrantAccessEventBody;
  containerManifestHistory: readonly AccessManifestBundleWire[];
  containerId: string;
  containerKey: Uint8Array;
  event: AccessEvent;
  eventHash: string;
  grant: ContainerDirectGrant;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  recipientTarget: ContainerKekRecipientTarget;
  state: ContainerAccessManifestState;
  targetKek: ContainerKekResponse;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}): MaterializedContainerSharePlan {
  const keyEpoch = readContainerKeyEpoch(
    input.targetKek.keyEpoch,
    "Container share key epoch",
  );
  const plan: ContainerSharePlan = {
    body: input.body,
    containerId: input.containerId,
    event: input.event,
    eventHash: input.eventHash,
    grant: input.grant,
    keyEpoch,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    previousKeyring: readCanonicalRecordOrNull(
      input.previousProjection.containerKeks.at(-1)?.keyring ?? null,
      "Container share previous keyring",
    ),
    previousManifest: input.previousManifest,
    recipientTarget: input.recipientTarget,
    request: buildContainerShareRequest({
      body: input.body,
      containerManifestHistory: input.containerManifestHistory,
      event: input.event,
      keyEpoch,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      parentKek: getParentKekForTarget(input.previousProjection),
      previousManifest: input.previousManifest,
      previousProjection: input.previousProjection,
      principalPolicies: input.principalPolicies,
      userRecipientKeys: input.userRecipientKeys,
      wraps: input.wraps,
    }),
    state: input.state,
    userRecipientKeys: input.userRecipientKeys,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}

function collectShareUserRecipientKeys(input: {
  newUserRecipientKey?: ContainerUserRecipientKey | undefined;
  state: ContainerAccessManifestState;
  targetKek: ContainerKekResponse;
}): ContainerUserRecipientKey[] {
  const directUserIds = new Set(
    input.state.directGrants.flatMap((grant) =>
      grant.subjectType === "user" ? [grant.subjectId] : [],
    ),
  );
  const userRecipientKeyByUserId = new Map<string, ContainerUserRecipientKey>();

  for (const target of readContainerKekRecipientTargets(
    input.targetKek.recipientTargets,
    "Container share target KEK recipient targets",
  )) {
    if (
      target.recipientKind !== "user" ||
      !directUserIds.has(target.recipientId)
    ) {
      continue;
    }
    userRecipientKeyByUserId.set(target.recipientId, {
      userId: target.recipientId,
      recipientKeyEpochId: target.recipientKeyEpochId,
      recipientKeyFingerprint: target.recipientKeyFingerprint,
    });
  }

  if (input.newUserRecipientKey) {
    userRecipientKeyByUserId.set(
      input.newUserRecipientKey.userId,
      input.newUserRecipientKey,
    );
  }

  const missingUserId = [...directUserIds].find(
    (userId) => !userRecipientKeyByUserId.has(userId),
  );
  if (missingUserId) {
    throw new Error(
      `Container share recipient key is missing for direct user grant ${missingUserId}`,
    );
  }

  return [...userRecipientKeyByUserId.values()].sort((left, right) =>
    left.userId.localeCompare(right.userId),
  );
}

async function collectContainerSharePrincipalPolicies(input: {
  execSql: ExecSql;
  principalPolicyCache?: PrincipalPolicyCache | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  recipientPolicy?: VerifiedPrincipalPolicy | undefined;
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const previousPolicies =
    await collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      principalPolicyCache: input.principalPolicyCache,
      projection: input.previousProjection,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  const recipientPolicy = input.recipientPolicy;
  const retainedPreviousPolicies = recipientPolicy
    ? previousPolicies.filter(
        (policy) =>
          policy.principalType !== recipientPolicy.principalType ||
          policy.principalId !== recipientPolicy.principalId,
      )
    : previousPolicies;

  return uniquePrincipalPolicies([
    ...retainedPreviousPolicies,
    ...(recipientPolicy ? [recipientPolicy] : []),
  ]);
}

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
  const containerKey = keksByEpochId.get(target.kek.containerKeyEpochId);
  if (!containerKey) {
    throw new Error("Container share target KEK could not be unwrapped");
  }
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

  return {
    containerKey: materializedPlan.containerKey,
    plan: materializedPlan.plan,
    response,
  };
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
    deferCheckpointAdvance: true,
    execSql: input.execSql,
    groupId: input.recipientGroupId,
    organizationId: input.author.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql: input.execSql,
    policies: verifiedPrincipalPolicy.checkpointPolicies,
  });
  for (const dependencyBundle of verifiedPrincipalPolicy.dependencyBundles) {
    await savePrincipalPolicyBundle(
      input.execSql,
      dependencyBundle,
      new Date().toISOString(),
    );
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
  );

  return {
    containerKey: materializedPlan.containerKey,
    plan: materializedPlan.plan,
    response,
  };
}
