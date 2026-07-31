import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerMoveAccessEventBody,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  createContainerKekPredecessorBridge,
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
  resolveContainerKekEpochId,
  signContainerMutationEvent,
} from "../../../data/containers/shared/events";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import {
  principalPolicyRequestRecord,
  uniquePrincipalPolicies,
} from "../../../data/containers/shared/principalPolicies";
import {
  asContainerManifestBundle,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
  wrapContainerKeyToParent,
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
  collectContainerWriterProjectionPrincipalPolicies,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

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
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  predecessorBridge: ContainerKekPredecessorBridge;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
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
    wraps: readCanonicalRecords(input.wraps, "Container move wraps"),
    parentKekState: readCanonicalRecord(
      input.destinationParentKek,
      "Container move destination parent KEK state",
    ),
    userRecipientKeys: [],
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

function containerMoveDependencyManifestHashes(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  previousProjection: ContainerWriterProjectionResponse;
}): string[] {
  return [
    ...uniqueSortedManifestHashes(input.previousProjection.path),
    ...uniqueSortedManifestHashes(input.destinationParentProjection.path),
  ];
}

async function collectContainerMovePrincipalPolicies(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const [sourcePolicies, destinationParentPolicies] = await Promise.all([
    collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      projection: input.previousProjection,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }),
    collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      projection: input.destinationParentProjection,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }),
  ]);

  return uniquePrincipalPolicies([
    ...sourcePolicies,
    ...destinationParentPolicies,
  ]);
}

async function collectContainerMoveProjectionPrincipalPolicies(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  return collectContainerMovePrincipalPolicies({
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}

async function buildMoveRotation(input: {
  containerId: string;
  currentKek: ContainerKekResponse;
  keyMaterial: Uint8Array;
  override?: string | undefined;
}): Promise<{
  containerKeyEpochId: string;
  predecessorBridge: ContainerKekPredecessorBridge;
}> {
  const keyEpoch = input.currentKek.containerKeyEpoch + 1;
  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: input.containerId,
    keyEpoch,
    keyMaterial: input.keyMaterial,
    override: input.override,
  });
  const predecessorBridge = await createContainerKekPredecessorBridge({
    containerId: input.containerId,
    predecessorContainerKey: input.keyMaterial,
    predecessorContainerKeyEpochId: input.currentKek.containerKeyEpochId,
    successorContainerKey: input.keyMaterial,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  return { containerKeyEpochId, predecessorBridge };
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
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  predecessorBridge: ContainerKekPredecessorBridge;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  state: ContainerAccessManifestState;
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
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      previousManifest: input.previousManifest,
      previousProjection: input.previousProjection,
      predecessorBridge: input.predecessorBridge,
      principalPolicies: input.principalPolicies,
      wraps: input.wraps,
    }),
    state: input.state,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}

async function buildMaterializedContainerMovePlan(
  input: BuildMaterializedContainerMovePlanInput & {
    resolveProjectionUserKey: ProjectionUserKeyResolver;
    warmReferencedPrincipalPolicies?:
      | ReferencedPrincipalPolicyWarmer
      | undefined;
  },
): Promise<MaterializedContainerMovePlan> {
  const { containerKey, destinationParent, destinationParentKey, source } =
    await unwrapMoveContainerKeys({
      destinationParentProjection: input.destinationParentProjection,
      execSql: input.execSql,
      previousProjection: input.previousProjection,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  const previousState = readContainerState(source.manifest);
  const destinationState = readContainerState(destinationParent.manifest);
  assertContainerMoveOrganizations({
    authorOrganizationId: input.author.organizationId,
    destinationState,
    previousState,
  });

  const nextContainerKeyEpoch = source.kek.containerKeyEpoch + 1;
  const { containerKeyEpochId, predecessorBridge } = await buildMoveRotation({
    containerId: previousState.containerId,
    keyMaterial: containerKey,
    override: input.containerKeyEpochId,
    currentKek: source.kek,
  });
  const body: ContainerMoveAccessEventBody = {
    eventType: "container.move",
    parentContainerId: destinationState.containerId,
    parentManifestHash: destinationParent.manifest.manifestHash,
    containerKeyEpochId,
  };
  const { event, eventHash } = await signContainerMutationEvent({
    author: input.author,
    body,
    containerId: previousState.containerId,
    dependencyManifestHashes: containerMoveDependencyManifestHashes(input),
    eventId: input.eventId ?? crypto.randomUUID(),
    previousManifestHash: source.manifest.manifestHash,
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } = await deriveContainerMoveManifest({
    containerKeyEpochId,
    destinationParent: destinationParent.manifest,
    eventHash,
    previousManifest: source.manifest,
  });
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: previousState.containerId,
    containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: destinationParent.kek.containerKeyEpochId,
  });
  keyEpoch.keyEpoch = nextContainerKeyEpoch;
  const wraps = [
    await wrapContainerKeyToParent({
      containerKey,
      containerKeyEpochId,
      manifestHash,
      parentKek: destinationParent.kek,
      parentKekMaterial: destinationParentKey,
    }),
  ];
  const principalPolicies =
    await collectContainerMoveProjectionPrincipalPolicies(input);

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
    manifest,
    manifestHash,
    previousManifest: asContainerManifestBundle(source.manifest),
    previousProjection: input.previousProjection,
    predecessorBridge,
    principalPolicies,
    state,
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
