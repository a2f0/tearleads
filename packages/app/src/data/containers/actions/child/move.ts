import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerMoveAccessEventBody,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
} from "@tearleads/crypto";
import type {
  ContainerManifestBundle,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
  unwrapContainerKekPath,
} from "../../../documents/documentRuntime";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  requireProjectionUserKeyResolver,
} from "../../../keyingProjectionVerification";
import type { ExecSql } from "../../../persistence/sqlSchema";
import {
  buildContainerCreateKeyEpoch,
  resolveContainerKekEpochId,
  signContainerMutationEvent,
} from "../../shared/events";
import {
  asContainerManifestBundle,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
  wrapContainerKeyToParent,
} from "../../shared/projection";
import type {
  BuildMaterializedContainerMovePlanInput,
  ContainerMoveApi,
  ContainerMovePlan,
  ContainerMutationAuthor,
  MaterializedContainerMovePlan,
} from "../../shared/types";

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
  previousManifest: ContainerManifestBundle;
  previousProjection: ContainerWriterProjectionResponse;
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
    principalPolicies: [],
    keyEpoch: readCanonicalRecord(input.keyEpoch, "Container move key epoch"),
    wraps: readCanonicalRecords(input.wraps, "Container move wraps"),
    parentKekState: readCanonicalRecord(
      input.destinationParentKek,
      "Container move destination parent KEK state",
    ),
    userRecipientKeys: [],
  };
}

async function unwrapMoveContainerKeys(
  input: {
    destinationParentKek: ContainerKekResponse;
    destinationParentProjection: ContainerWriterProjectionResponse;
    execSql?: ExecSql | undefined;
    previousProjection: ContainerWriterProjectionResponse;
    sourceKek: ContainerKekResponse;
    targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<{
  containerKey: Uint8Array;
  destinationParentKey: Uint8Array;
}> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const containerKey = keksByEpochId.get(input.sourceKek.containerKeyEpochId);
  if (!containerKey) {
    throw new Error("Container move source KEK could not be unwrapped");
  }

  const destinationKeksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.destinationParentProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const destinationParentKey = destinationKeksByEpochId.get(
    input.destinationParentKek.containerKeyEpochId,
  );
  if (!destinationParentKey) {
    throw new Error(
      "Container move destination parent KEK could not be unwrapped",
    );
  }

  return { containerKey, destinationParentKey };
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
  previousManifest: ContainerManifestBundle;
  previousProjection: ContainerWriterProjectionResponse;
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
      wraps: input.wraps,
    }),
    state: input.state,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}

async function buildMaterializedContainerMovePlan(
  input: BuildMaterializedContainerMovePlanInput &
    ProjectionVerificationOptions,
): Promise<MaterializedContainerMovePlan> {
  const source = getTargetContainerContext(input.previousProjection);
  const destinationParent = getTargetContainerContext(
    input.destinationParentProjection,
  );
  const previousState = readContainerState(source.manifest);
  const destinationState = readContainerState(destinationParent.manifest);
  assertContainerMoveOrganizations({
    authorOrganizationId: input.author.organizationId,
    destinationState,
    previousState,
  });

  const { containerKey, destinationParentKey } = await unwrapMoveContainerKeys({
    destinationParentKek: destinationParent.kek,
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    sourceKek: source.kek,
    targetSecretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const nextContainerKeyEpoch = source.kek.containerKeyEpoch + 1;
  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: previousState.containerId,
    keyEpoch: nextContainerKeyEpoch,
    keyMaterial: containerKey,
    override: input.containerKeyEpochId,
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
  execSql?: ExecSql | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
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
  });
  const response = await input.apiClient.moveContainer(
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
