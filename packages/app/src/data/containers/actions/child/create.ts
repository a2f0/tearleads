import {
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  projectionVerificationOptions,
  unwrapContainerKekPath,
} from "../../../documents/documentRuntime";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../keyingCanonicalJson";
import type { ProjectionUserKeyResolver } from "../../../keyingProjectionVerification";
import { requireProjectionUserKeyResolver } from "../../../keyingProjectionVerification";
import {
  buildContainerCreateBody,
  buildContainerCreateKeyEpoch,
  buildParentRecipientTargets,
  deriveContainerCreateManifest,
  resolveContainerKekEpochId,
  signContainerCreateEvent,
} from "../../shared/events";
import {
  asContainerManifestBundle,
  getParentCreateContext,
  wrapContainerKeyToParent,
} from "../../shared/projection";
import type {
  BuildContainerCreatePlanInput,
  ContainerCreateApi,
  ContainerCreatePlan,
  ContainerCreatePlanContext,
  ContainerMutationAuthor,
  CreateRemoteContainerResult,
  MaterializedContainerCreatePlan,
} from "../../shared/types";

function assertContainerCreatePlanInput(input: {
  author: ContainerMutationAuthor;
  containerKey: Uint8Array;
  parentKekMaterial: Uint8Array;
  parentProjection: ContainerWriterProjectionResponse;
}): void {
  if (input.containerKey.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }
  if (input.parentKekMaterial.byteLength !== 32) {
    throw new Error("Container parent KEK material must be 32 bytes");
  }
  if (input.author.organizationId !== input.parentProjection.organizationId) {
    throw new Error(
      "Container author organization does not match parent projection",
    );
  }
}

function buildContainerCreateRequest(input: {
  body: import("@tearleads/crypto").ContainerCreateAccessEventBody;
  event: import("@tearleads/crypto").AccessEvent;
  keyEpoch: import("@tearleads/crypto").ContainerKeyEpoch;
  manifest: import("@tearleads/crypto").AccessManifest;
  manifestHash: string;
  parentKek: import("@tearleads/validators/response").ContainerKekResponse;
  parentProjection: ContainerWriterProjectionResponse;
  wraps: readonly import("@tearleads/crypto").ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    event: readCanonicalRecord(input.event, "Container create event"),
    body: readCanonicalRecord(input.body, "Container create body"),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(input.manifest, "Container create manifest"),
    previousManifest: null,
    parentContainerPath: input.parentProjection.path.map(
      asContainerManifestBundle,
    ),
    principalPolicies: [],
    keyEpoch: readCanonicalRecord(input.keyEpoch, "Container create key epoch"),
    wraps: readCanonicalRecords(input.wraps, "Container create wraps"),
    parentKekState: readCanonicalRecord(
      input.parentKek,
      "Container create parent KEK state",
    ),
    userRecipientKeys: [],
  };
}

async function resolveContainerCreatePlanContext(
  input: BuildContainerCreatePlanInput,
): Promise<ContainerCreatePlanContext> {
  assertContainerCreatePlanInput(input);
  const containerId = input.containerId ?? crypto.randomUUID();

  return {
    ...input,
    containerId,
    containerKeyEpochId: await resolveContainerKekEpochId({
      containerId,
      keyEpoch: 1,
      keyMaterial: input.containerKey,
      override: input.containerKeyEpochId,
    }),
    eventId: input.eventId ?? crypto.randomUUID(),
    metadataDocumentId: input.metadataDocumentId ?? crypto.randomUUID(),
    parent: getParentCreateContext(input.parentProjection),
    signedAt: input.signedAt ?? new Date().toISOString(),
  };
}

export async function buildContainerCreatePlan(
  input: BuildContainerCreatePlanInput,
): Promise<ContainerCreatePlan> {
  const context = await resolveContainerCreatePlanContext(input);
  const parentContainerId = context.parentProjection.containerId;
  const parentManifestHash = context.parent.manifest.manifestHash;
  const body = buildContainerCreateBody({
    containerKeyEpochId: context.containerKeyEpochId,
    metadataDocumentId: context.metadataDocumentId,
    parentContainerId,
    parentManifestHash,
  });
  const { event, eventHash } = await signContainerCreateEvent({
    author: context.author,
    body,
    containerId: context.containerId,
    eventId: context.eventId,
    parentPath: context.parentProjection.path,
    signedAt: context.signedAt,
  });
  const { manifest, manifestHash, state } = await deriveContainerCreateManifest(
    {
      author: context.author,
      containerId: context.containerId,
      containerKeyEpochId: context.containerKeyEpochId,
      eventHash,
      metadataDocumentId: context.metadataDocumentId,
      parentContainerId,
      parentManifestHash,
    },
  );
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: context.containerId,
    containerKeyEpochId: context.containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: context.parent.kek.containerKeyEpochId,
  });
  const recipientTargets = buildParentRecipientTargets(context.parent.kek);
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const wraps = [
    await wrapContainerKeyToParent({
      containerKey: context.containerKey,
      containerKeyEpochId: context.containerKeyEpochId,
      manifestHash,
      parentKek: context.parent.kek,
      parentKekMaterial: context.parentKekMaterial,
    }),
  ];
  return {
    body,
    containerId: context.containerId,
    containerKeyEpochId: context.containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: context.metadataDocumentId,
    parentContainerId,
    parentManifestHash,
    recipientTargets,
    request: buildContainerCreateRequest({
      body,
      event,
      keyEpoch,
      manifest,
      manifestHash,
      parentKek: context.parent.kek,
      parentProjection: context.parentProjection,
      wraps,
    }),
    state,
    wraps,
  };
}

export async function buildMaterializedContainerCreatePlan(
  input: {
    author: ContainerMutationAuthor;
    containerId?: string | undefined;
    containerKey?: Uint8Array | undefined;
    containerKeyEpochId?: string | undefined;
    eventId?: string | undefined;
    execSql?: import("../../../persistence/sqlSchema").ExecSql | undefined;
    metadataDocumentId?: string | undefined;
    parentProjection: ContainerWriterProjectionResponse;
    parentSecretKey: Uint8Array;
    signedAt?: string | undefined;
  } & import("../../../documents/documentRuntime").ProjectionVerificationOptions,
): Promise<MaterializedContainerCreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));

  const parent = getParentCreateContext(input.parentProjection);
  const parentKeksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.parentProjection,
    secretKey: input.parentSecretKey,
    ...projectionVerificationOptions(input),
  });
  const parentKekMaterial = parentKeksByEpochId.get(
    parent.kek.containerKeyEpochId,
  );
  if (!parentKekMaterial) {
    throw new Error("Container parent KEK could not be unwrapped");
  }

  const plan = await buildContainerCreatePlan({
    author: input.author,
    containerId: input.containerId,
    containerKey,
    containerKeyEpochId: input.containerKeyEpochId,
    eventId: input.eventId,
    metadataDocumentId: input.metadataDocumentId,
    parentKekMaterial,
    parentProjection: input.parentProjection,
    signedAt: input.signedAt,
  });

  return {
    containerKey,
    plan,
  };
}

export async function createRemoteContainer(input: {
  apiClient: ContainerCreateApi;
  author: ContainerMutationAuthor;
  containerId?: string | undefined;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  execSql?: import("../../../persistence/sqlSchema").ExecSql | undefined;
  metadataDocumentId?: string | undefined;
  parentContainerId: string;
  parentSecretKey: Uint8Array;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
}): Promise<CreateRemoteContainerResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container create",
  );
  const parentProjection = await input.apiClient.getContainerWriterProjection(
    input.parentContainerId,
  );
  if (!parentProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerCreatePlan({
    author: input.author,
    containerId: input.containerId,
    containerKey: input.containerKey,
    containerKeyEpochId: input.containerKeyEpochId,
    eventId: input.eventId,
    execSql: input.execSql,
    metadataDocumentId: input.metadataDocumentId,
    parentProjection,
    parentSecretKey: input.parentSecretKey,
    resolveProjectionUserKey,
    signedAt: input.signedAt,
  });
  const response = await input.apiClient.createContainer(
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }

  return {
    containerKey: materializedPlan.containerKey,
    containerId: response.containerId,
    metadataDocumentId: materializedPlan.plan.metadataDocumentId,
    plan: materializedPlan.plan,
    response,
  };
}
