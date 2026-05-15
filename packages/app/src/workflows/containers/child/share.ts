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
  type PrincipalPolicyBundle,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type {
  ContainerManifestBundle,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { signContainerMutationEvent } from "../../../data/containers/shared/events";
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
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../../data/documents/shared/types";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type ProjectionUserKeyResolver,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import {
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
  principalPolicyCheckpoint,
} from "../../principals/policyVerification";

interface ContainerManagedPrincipalShareApi extends ContainerShareApi {
  getCurrentPrincipalPolicy: (
    principalType: ManagedPrincipalKind,
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  getEncapsulationKey: (
    userId: string,
  ) => Promise<EncapsulationKeyResponse | null>;
}

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
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse | null;
  previousManifest: ContainerManifestBundle;
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
    containerManifestHistory: [input.previousManifest],
    principalPolicies: readCanonicalRecords(
      input.principalPolicies.map((policy) =>
        principalPolicyRequestRecord(policy),
      ),
      "Container share principal policies",
    ),
    keyEpoch: readCanonicalRecord(input.keyEpoch, "Container share key epoch"),
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

function buildContainerSharePlanResult(input: {
  body: ContainerGrantAccessEventBody;
  containerId: string;
  containerKey: Uint8Array;
  event: AccessEvent;
  eventHash: string;
  grant: ContainerDirectGrant;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: ContainerManifestBundle;
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
    previousManifest: input.previousManifest,
    recipientTarget: input.recipientTarget,
    request: buildContainerShareRequest({
      body: input.body,
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

function principalPolicySignerPublicKeyLoadErrorMessage(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): string {
  switch (code) {
    case "fingerprint-invalid":
      return "principal policy signer key fingerprint is invalid";
    case "fingerprint-mismatch":
      return "principal policy signer key fingerprint mismatch";
    case "not-found":
      return "principal policy signer key could not be loaded";
    case "user-mismatch":
      return "principal policy signer key user mismatch";
  }
}

function principalPolicyReferenceFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): ReferencedPrincipalHead {
  return {
    principalType: bundle.currentState.principalType,
    principalId: bundle.currentState.principalId,
    version: bundle.currentState.version,
    keyEpoch: bundle.currentState.keyEpoch,
    stateHash: bundle.currentState.stateHash,
    keyFingerprint: bundle.currentState.keyFingerprint,
  };
}

async function loadVerifiedSharePrincipalPolicy(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  execSql?: ExecSql | undefined;
  principalId: string;
  principalType: ManagedPrincipalKind;
}): Promise<VerifiedPrincipalPolicy> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    input.principalType,
    input.principalId,
  );
  if (!bundle) {
    throw new Error("Container share principal policy could not be loaded");
  }
  if (
    bundle.currentState.principalType !== input.principalType ||
    bundle.currentState.principalId !== input.principalId
  ) {
    throw new Error("Container share principal policy target mismatch");
  }

  const cachedBundle = input.execSql
    ? await loadPrincipalPolicyBundle(
        input.execSql,
        input.principalType,
        input.principalId,
      )
    : null;
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    getEncapsulationKey: (userId) =>
      input.apiClient.getEncapsulationKey(userId),
  });
  if ("error" in signerPublicKeys) {
    throw new Error(
      principalPolicySignerPublicKeyLoadErrorMessage(signerPublicKeys.error),
    );
  }

  const verified = await verifyPrincipalPolicyBundle({
    bundle: bundle as PrincipalPolicyBundle,
    expectedReference: principalPolicyReferenceFromBundle(bundle),
    localCheckpoint: principalPolicyCheckpoint(cachedBundle),
    signerPublicKeys: signerPublicKeys.signerPublicKeys,
  });
  if (!verified.ok) {
    throw new Error(
      `Container share principal policy verification failed: ${verified.error.message}`,
    );
  }

  if (input.execSql) {
    await savePrincipalPolicyBundle(
      input.execSql,
      bundle,
      new Date().toISOString(),
    );
  }

  return verified.value;
}

async function collectContainerSharePrincipalPolicies(input: {
  execSql?: ExecSql | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  recipientPolicy?: VerifiedPrincipalPolicy | undefined;
  resolveUserKey?: ProjectionUserKeyResolver | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const previousPolicies = input.resolveUserKey
    ? await collectContainerWriterProjectionPrincipalPolicies({
        execSql: input.execSql,
        projection: input.previousProjection,
        resolveUserKey: input.resolveUserKey,
      })
    : [];

  return uniquePrincipalPolicies([
    ...previousPolicies,
    ...(input.recipientPolicy ? [input.recipientPolicy] : []),
  ]);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Container share planning keeps the cryptographic transition in one auditable sequence.
async function buildMaterializedContainerSharePlan(
  input: {
    accessLevel: ContainerAccessLevel;
    author: ContainerMutationAuthor;
    eventId?: string | undefined;
    execSql?: ExecSql | undefined;
    previousProjection: ContainerWriterProjectionResponse;
    recipient: ContainerShareRecipient;
    signedAt?: string | undefined;
    targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<MaterializedContainerSharePlan> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
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
    previousProjection: input.previousProjection,
    ...(input.recipient.subjectType === "user"
      ? {}
      : { recipientPolicy: input.recipient.principalPolicy }),
    resolveUserKey: input.resolveProjectionUserKey,
  });

  return buildContainerSharePlanResult({
    body,
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
  execSql?: ExecSql | undefined;
  recipientEncapsulationPublicKey: Uint8Array;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
  response: ContainerMutationResponse;
} | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container share",
  );
  const previousProjection = await input.apiClient.getContainerWriterProjection(
    input.containerId,
  );
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
      recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
      subjectId: input.recipientUserId,
      subjectType: "user",
    },
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
  });
  const response = await input.apiClient.shareContainer(
    input.containerId,
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }

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
  execSql?: ExecSql | undefined;
  recipientGroupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
  response: ContainerMutationResponse;
} | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container share",
  );
  const previousProjection = await input.apiClient.getContainerWriterProjection(
    input.containerId,
  );
  if (!previousProjection) {
    return null;
  }
  const principalPolicy = await loadVerifiedSharePrincipalPolicy({
    apiClient: input.apiClient,
    execSql: input.execSql,
    principalId: input.recipientGroupId,
    principalType: "group",
  });

  const materializedPlan = await buildMaterializedContainerSharePlan({
    accessLevel: input.accessLevel,
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    previousProjection,
    recipient: {
      principalPolicy,
      subjectId: input.recipientGroupId,
      subjectType: "group",
    },
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
  });
  const response = await input.apiClient.shareContainer(
    input.containerId,
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }

  return {
    containerKey: materializedPlan.containerKey,
    plan: materializedPlan.plan,
    response,
  };
}
