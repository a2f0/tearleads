import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerMoveAccessEventBody,
  ContainerUserRecipientKey,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKekKeyringHash,
  computeContainerKekPredecessorBridgeHash,
  deriveContainerAccessManifest,
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
import {
  buildContainerCreateKeyEpoch,
  signContainerMutationEvent,
} from "../../../data/containers/shared/events";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import { principalPolicyRequestRecord } from "../../../data/containers/shared/principalPolicies";
import {
  asContainerManifestBundle,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
} from "../../../data/containers/shared/projection";
import type {
  BuildMaterializedContainerMovePlanInput,
  ContainerMoveApi,
  ContainerMovePlan,
  ContainerMutationAuthor,
  MaterializedContainerMovePlan,
} from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildContainerRotationArtifacts } from "./moveRotation";
import { buildContainerMoveWraps } from "./moveWraps";

async function deriveContainerMoveManifest(input: {
  containerKeyEpochId: string;
  destinationParent: ContainerWriterProjectionResponse["path"][number];
  eventHash: string;
  previousManifest: ContainerWriterProjectionResponse["path"][number];
}): Promise<Pick<ContainerMovePlan, "manifest" | "manifestHash" | "state">> {
  const previousState = readContainerState(input.previousManifest);
  const destinationState = readContainerState(input.destinationParent);
  const state: ContainerAccessManifestState = {
    ...previousState,
    epoch: previousState.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash: input.eventHash,
    parentContainerId: destinationState.containerId,
    parentManifestHash: input.destinationParent.manifestHash,
    containerKeyEpochId: input.containerKeyEpochId,
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

function buildContainerMoveRequest(input: {
  body: ContainerMoveAccessEventBody;
  destinationParentKek: ContainerKekResponse;
  destinationParentProjection: ContainerWriterProjectionResponse;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  keyring: ContainerKekKeyring;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  predecessorBridge: ContainerKekPredecessorBridge;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    event: readCanonicalRecord(input.event, "Container move event"),
    body: readCanonicalRecord(input.body, "Container move body"),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(input.manifest, "Container move manifest"),
    previousManifest: input.previousManifest,
    previousContainerPath: input.previousProjection.path.map(
      asContainerManifestBundle,
    ),
    destinationParentContainerPath: input.destinationParentProjection.path.map(
      asContainerManifestBundle,
    ),
    principalPolicies: readCanonicalRecords(
      input.principalPolicies.map((policy) =>
        principalPolicyRequestRecord(policy),
      ),
      "Container move principal policies",
    ),
    keyEpoch: readCanonicalRecord(input.keyEpoch, "Container move key epoch"),
    predecessorBridge: readCanonicalRecord(
      input.predecessorBridge,
      "Container move predecessor bridge",
    ),
    keyring: readCanonicalRecord(input.keyring, "Container move keyring"),
    wraps: readCanonicalRecords(input.wraps, "Container move wraps"),
    parentKekState: readCanonicalRecord(
      input.destinationParentKek,
      "Container move destination parent KEK state",
    ),
    userRecipientKeys: readCanonicalRecords(
      input.userRecipientKeys,
      "Container move user recipient keys",
    ),
  };
}

async function unwrapMoveContainerKeys(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  destinationParentKey: Uint8Array;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  source: ReturnType<typeof getTargetContainerContext>;
}> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const source = getTargetContainerContext(input.previousProjection);
  const containerKey = keksByEpochId.get(source.kek.containerKeyEpochId);
  if (!containerKey) {
    throw new Error("Container move source KEK could not be unwrapped");
  }

  const destinationKeksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.destinationParentProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const destinationParent = getTargetContainerContext(
    input.destinationParentProjection,
  );
  const destinationParentKey = destinationKeksByEpochId.get(
    destinationParent.kek.containerKeyEpochId,
  );
  if (!destinationParentKey) {
    throw new Error(
      "Container move destination parent KEK could not be unwrapped",
    );
  }

  return { containerKey, destinationParentKey, destinationParent, source };
}

function assertContainerMoveOrganizations(input: {
  authorOrganizationId: string;
  destinationState: ContainerAccessManifestState;
  previousState: ContainerAccessManifestState;
}): void {
  if (input.previousState.organizationId !== input.authorOrganizationId) {
    throw new Error("Container move author organization mismatch");
  }
  if (input.destinationState.organizationId !== input.authorOrganizationId) {
    throw new Error("Container move destination organization mismatch");
  }
}

function readContainerMoveStates(input: {
  authorOrganizationId: string;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  const previousState = readContainerState(input.source.manifest);
  const destinationState = readContainerState(input.destinationParent.manifest);
  assertContainerMoveOrganizations({
    authorOrganizationId: input.authorOrganizationId,
    destinationState,
    previousState,
  });
  return { destinationState, previousState };
}

function containerMoveDependencyManifestHashes(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  previousProjection: ContainerWriterProjectionResponse;
}): string[] {
  return [
    ...uniqueSortedManifestHashes(input.previousProjection.path),
    ...uniqueSortedManifestHashes(input.destinationParentProjection.path),
  ];
}

function buildContainerMovePlanResult(input: {
  body: ContainerMoveAccessEventBody;
  containerId: string;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  destinationParentKek: ContainerKekResponse;
  destinationParentProjection: ContainerWriterProjectionResponse;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyring: ContainerKekKeyring;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  predecessorBridge: ContainerKekPredecessorBridge;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}): MaterializedContainerMovePlan {
  const plan: ContainerMovePlan = {
    body: input.body,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    event: input.event,
    eventHash: input.eventHash,
    keyEpoch: input.keyEpoch,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    previousManifest: input.previousManifest,
    request: buildContainerMoveRequest({
      body: input.body,
      destinationParentKek: input.destinationParentKek,
      destinationParentProjection: input.destinationParentProjection,
      event: input.event,
      keyEpoch: input.keyEpoch,
      keyring: input.keyring,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      previousManifest: input.previousManifest,
      previousProjection: input.previousProjection,
      predecessorBridge: input.predecessorBridge,
      principalPolicies: input.principalPolicies,
      userRecipientKeys: input.userRecipientKeys,
      wraps: input.wraps,
    }),
    state: input.state,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}

async function buildContainerMoveEventBody(input: {
  containerKeyEpochId: string;
  keyring: ContainerKekKeyring;
  parentContainerId: string;
  parentManifestHash: string;
  predecessorBridge: ContainerKekPredecessorBridge;
}): Promise<ContainerMoveAccessEventBody> {
  return {
    eventType: "container.move",
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    containerKeyEpochId: input.containerKeyEpochId,
    keyringHash: await computeContainerKekKeyringHash(input.keyring),
    predecessorBridgeHash: await computeContainerKekPredecessorBridgeHash(
      input.predecessorBridge,
    ),
  };
}

type MaterializedContainerMoveInput =
  BuildMaterializedContainerMovePlanInput & {
    resolveProjectionUserKey: ProjectionUserKeyResolver;
    warmReferencedPrincipalPolicies?:
      | ReferencedPrincipalPolicyWarmer
      | undefined;
  };

function signContainerMoveEvent(input: {
  body: ContainerMoveAccessEventBody;
  containerId: string;
  planInput: MaterializedContainerMoveInput;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  return signContainerMutationEvent({
    author: input.planInput.author,
    body: input.body,
    containerId: input.containerId,
    dependencyManifestHashes: containerMoveDependencyManifestHashes(
      input.planInput,
    ),
    eventId: input.planInput.eventId ?? crypto.randomUUID(),
    previousManifestHash: input.source.manifest.manifestHash,
    signedAt: input.planInput.signedAt ?? new Date().toISOString(),
  });
}

function buildMoveKeyEpoch(input: {
  containerKeyEpochId: string;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  eventHash: string;
  manifestHash: string;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: readContainerState(input.source.manifest).containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    eventHash: input.eventHash,
    manifestHash: input.manifestHash,
    parentContainerKeyEpochId: input.destinationParent.kek.containerKeyEpochId,
  });
  keyEpoch.keyEpoch = input.source.kek.containerKeyEpoch + 1;
  return keyEpoch;
}

async function buildMoveRotationWithBody(input: {
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  destinationState: ContainerAccessManifestState;
  override: string | undefined;
  predecessorContainerKey: Uint8Array;
  previousState: ContainerAccessManifestState;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  const rotation = await buildContainerRotationArtifacts({
    containerId: input.previousState.containerId,
    currentKek: input.source.kek,
    currentKeyMaterial: input.predecessorContainerKey,
    keyEpoch: input.source.kek.containerKeyEpoch + 1,
    override: input.override,
  });
  const body = await buildContainerMoveEventBody({
    containerKeyEpochId: rotation.containerKeyEpochId,
    keyring: rotation.keyring,
    parentContainerId: input.destinationState.containerId,
    parentManifestHash: input.destinationParent.manifest.manifestHash,
    predecessorBridge: rotation.predecessorBridge,
  });
  return { ...rotation, body };
}

async function deriveMoveManifestArtifacts(input: {
  body: ContainerMoveAccessEventBody;
  containerKeyEpochId: string;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  planInput: MaterializedContainerMoveInput;
  previousState: ContainerAccessManifestState;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  const { event, eventHash } = await signContainerMoveEvent({
    body: input.body,
    containerId: input.previousState.containerId,
    planInput: input.planInput,
    source: input.source,
  });
  const { manifest, manifestHash, state } = await deriveContainerMoveManifest({
    containerKeyEpochId: input.containerKeyEpochId,
    destinationParent: input.destinationParent.manifest,
    eventHash,
    previousManifest: input.source.manifest,
  });
  const keyEpoch = buildMoveKeyEpoch({
    containerKeyEpochId: input.containerKeyEpochId,
    destinationParent: input.destinationParent,
    eventHash,
    manifestHash,
    source: input.source,
  });
  return { event, eventHash, keyEpoch, manifest, manifestHash, state };
}

async function buildMaterializedContainerMovePlan(
  input: MaterializedContainerMoveInput,
): Promise<MaterializedContainerMovePlan> {
  const {
    containerKey: predecessorContainerKey,
    destinationParent,
    destinationParentKey,
    source,
  } = await unwrapMoveContainerKeys({
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const { destinationState, previousState } = readContainerMoveStates({
    authorOrganizationId: input.author.organizationId,
    destinationParent,
    source,
  });
  const {
    body,
    containerKey,
    containerKeyEpochId,
    keyring,
    predecessorBridge,
  } = await buildMoveRotationWithBody({
    destinationParent,
    destinationState,
    override: input.containerKeyEpochId,
    predecessorContainerKey,
    previousState,
    source,
  });
  const { event, eventHash, keyEpoch, manifest, manifestHash, state } =
    await deriveMoveManifestArtifacts({
      body,
      containerKeyEpochId,
      destinationParent,
      planInput: input,
      previousState,
      source,
    });
  const { principalPolicies, userRecipientKeys, wraps } =
    await buildContainerMoveWraps({
      containerKey,
      containerKeyEpochId,
      destinationParentKek: destinationParent.kek,
      destinationParentKey,
      destinationParentProjection: input.destinationParentProjection,
      execSql: input.execSql,
      manifestHash,
      previousProjection: input.previousProjection,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      state,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });

  return buildContainerMovePlanResult({
    body,
    containerKey,
    containerId: previousState.containerId,
    containerKeyEpochId,
    destinationParentKek: destinationParent.kek,
    destinationParentProjection: input.destinationParentProjection,
    event,
    eventHash,
    keyEpoch,
    keyring,
    manifest,
    manifestHash,
    previousManifest: asContainerManifestBundle(source.manifest),
    previousProjection: input.previousProjection,
    predecessorBridge,
    principalPolicies,
    state,
    userRecipientKeys,
    wraps,
  });
}

export async function moveRemoteContainer(input: {
  apiClient: ContainerMoveApi;
  author: ContainerMutationAuthor;
  containerId: string;
  destinationParentContainerId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerMovePlan;
  response: ContainerMutationResponse;
} | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container move",
  );
  const [previousProjection, destinationParentProjection] = await Promise.all([
    input.apiClient.getContainerWriterProjection(input.containerId),
    input.apiClient.getContainerWriterProjection(
      input.destinationParentContainerId,
    ),
  ]);
  if (!previousProjection || !destinationParentProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerMovePlan({
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    previousProjection,
    destinationParentProjection,
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const response = await input.apiClient.moveContainer(
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
