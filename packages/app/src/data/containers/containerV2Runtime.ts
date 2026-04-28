import {
  type AccessEventV2,
  type AccessManifestV2,
  type ContainerAccessManifestStateV2,
  type ContainerCreateAccessEventBodyV2,
  type ContainerKekRecipientTargetV2,
  type ContainerKeyEpochV2,
  type ContainerKeyWrapV2,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  encryptWithDek,
  type KeyingV2CanonicalJson,
  signAccessEvent,
  type UnsignedAccessEventV2,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type {
  ContainerV2ManifestBundle,
  ContainerV2MutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2KekResponse,
  ContainerV2MutationResponse,
  ContainerV2WriterProjectionResponse,
} from "@tearleads/validators/response";
import { unwrapContainerV2KekPath } from "../documents/documentV2Runtime";
import type { ExecSql } from "../persistence/sqlSchema";

export interface ContainerV2MutationAuthor {
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

interface BuildContainerV2CreatePlanInput {
  author: ContainerV2MutationAuthor;
  containerId?: string | undefined;
  containerKey: Uint8Array;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  metadataDocumentId?: string | undefined;
  parentKekMaterial: Uint8Array;
  parentProjection: ContainerV2WriterProjectionResponse;
  signedAt?: string | undefined;
}

interface ContainerV2CreatePlan {
  body: ContainerCreateAccessEventBodyV2;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEventV2;
  eventHash: string;
  keyEpoch: ContainerKeyEpochV2;
  keyEpochHash: string;
  keyTargetHash: string;
  manifest: AccessManifestV2;
  manifestHash: string;
  metadataDocumentId: string;
  parentContainerId: string;
  parentManifestHash: string;
  recipientTargets: ContainerKekRecipientTargetV2[];
  request: ContainerV2MutationRequest;
  state: ContainerAccessManifestStateV2;
  wraps: ContainerKeyWrapV2[];
}

interface MaterializedContainerV2CreatePlan {
  containerKey: Uint8Array;
  plan: ContainerV2CreatePlan;
}

interface ContainerV2CreateApi {
  createContainerV2(
    input: ContainerV2MutationRequest,
  ): Promise<ContainerV2MutationResponse | null>;
  getContainerV2WriterProjection(
    containerId: string,
  ): Promise<ContainerV2WriterProjectionResponse | null>;
}

interface CreateRemoteContainerV2Result {
  containerKey: Uint8Array;
  containerId: string;
  metadataDocumentId: string;
  plan: ContainerV2CreatePlan;
  response: ContainerV2MutationResponse;
}

interface ParentContainerCreateContext {
  manifest: ContainerV2WriterProjectionResponse["path"][number];
  kek: ContainerV2KekResponse;
}

function readManifestContainerId(
  bundle: ContainerV2WriterProjectionResponse["path"][number],
): string | null {
  const containerId = isPlainObject(bundle.state)
    ? Reflect.get(bundle.state, "containerId")
    : undefined;

  return typeof containerId === "string" && containerId.length > 0
    ? containerId
    : null;
}

function uniqueSortedManifestHashes(
  path: readonly ContainerV2WriterProjectionResponse["path"][number][],
): string[] {
  return [...new Set(path.map((bundle) => bundle.manifestHash))].sort();
}

function getParentCreateContext(
  parentProjection: ContainerV2WriterProjectionResponse,
): ParentContainerCreateContext {
  if (parentProjection.path.length !== parentProjection.containerKeks.length) {
    throw new Error(
      "Container V2 parent projection path and KEKs are inconsistent",
    );
  }

  const manifest = parentProjection.path.at(-1);
  const kek = parentProjection.containerKeks.at(-1);
  if (!manifest || !kek) {
    throw new Error("Container V2 parent projection is empty");
  }
  if (readManifestContainerId(manifest) !== parentProjection.containerId) {
    throw new Error("Container V2 parent projection target is inconsistent");
  }
  if (kek.containerId !== parentProjection.containerId) {
    throw new Error("Container V2 parent KEK target is inconsistent");
  }
  if (kek.accessManifestHash !== manifest.manifestHash) {
    throw new Error("Container V2 parent KEK is stale");
  }

  return { manifest, kek };
}

function asContainerV2ManifestBundle(
  bundle: ContainerV2WriterProjectionResponse["path"][number],
): ContainerV2ManifestBundle {
  return bundle as unknown as ContainerV2ManifestBundle;
}

async function wrapContainerKeyToParent(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  parentKek: ContainerV2KekResponse;
  parentKekMaterial: Uint8Array;
}): Promise<ContainerKeyWrapV2> {
  const wrapped = await encryptWithDek(
    input.containerKey,
    input.parentKekMaterial,
  );

  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "container",
    recipientId: input.parentKek.containerId,
    recipientKeyEpochId: input.parentKek.containerKeyEpochId,
    recipientKeyFingerprint: input.parentKek.keyEpochHash,
    kemCipherText: bytesToBase64(wrapped.iv),
    wrappedKey: bytesToBase64(wrapped.ciphertext),
    wrapManifestHash: input.manifestHash,
  };
}

function assertContainerV2CreatePlanInput(input: {
  author: ContainerV2MutationAuthor;
  containerKey: Uint8Array;
  parentKekMaterial: Uint8Array;
  parentProjection: ContainerV2WriterProjectionResponse;
}): void {
  if (input.containerKey.byteLength !== 32) {
    throw new Error("Container V2 KEK material must be 32 bytes");
  }
  if (input.parentKekMaterial.byteLength !== 32) {
    throw new Error("Container V2 parent KEK material must be 32 bytes");
  }
  if (input.author.organizationId !== input.parentProjection.organizationId) {
    throw new Error(
      "Container V2 author organization does not match parent projection",
    );
  }
}

function buildContainerV2CreateBody(input: {
  containerKeyEpochId: string;
  metadataDocumentId: string;
  parentContainerId: string;
  parentManifestHash: string;
}): ContainerCreateAccessEventBodyV2 {
  return {
    eventType: "container.create",
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
}

async function signContainerV2CreateEvent(input: {
  author: ContainerV2MutationAuthor;
  body: ContainerCreateAccessEventBodyV2;
  containerId: string;
  eventId: string;
  parentPath: ContainerV2WriterProjectionResponse["path"];
  signedAt: string;
}): Promise<Pick<ContainerV2CreatePlan, "event" | "eventHash">> {
  const bodyHash = await computeAccessEventBodyHash(
    input.body as unknown as KeyingV2CanonicalJson,
  );
  const unsignedEvent: UnsignedAccessEventV2 = {
    version: 2,
    eventId: input.eventId,
    eventType: "container.create",
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.author.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: uniqueSortedManifestHashes(input.parentPath),
    bodyHash,
    signerUserId: input.author.signerUserId,
    signerDeviceId: input.author.signerDeviceId,
    signerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.signedAt,
  };
  const event = await signAccessEvent(
    unsignedEvent,
    input.author.signerPrivateKey,
  );

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

async function deriveContainerV2CreateManifest(input: {
  author: ContainerV2MutationAuthor;
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  metadataDocumentId: string;
  parentContainerId: string;
  parentManifestHash: string;
}): Promise<
  Pick<ContainerV2CreatePlan, "manifest" | "manifestHash" | "state">
> {
  const state: ContainerAccessManifestStateV2 = {
    version: 2,
    containerId: input.containerId,
    organizationId: input.author.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: input.eventHash,
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

function buildContainerV2CreateKeyEpoch(input: {
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  manifestHash: string;
  parentContainerKeyEpochId: string;
}): ContainerKeyEpochV2 {
  return {
    id: input.containerKeyEpochId,
    containerId: input.containerId,
    keyEpoch: 1,
    accessManifestHash: input.manifestHash,
    parentContainerKeyEpochId: input.parentContainerKeyEpochId,
    createdByEventHash: input.eventHash,
    createdByManifestHash: input.manifestHash,
  };
}

function buildParentRecipientTargets(
  parentKek: ContainerV2KekResponse,
): ContainerKekRecipientTargetV2[] {
  return [
    {
      recipientKind: "container",
      recipientId: parentKek.containerId,
      recipientKeyEpochId: parentKek.containerKeyEpochId,
      recipientKeyFingerprint: parentKek.keyEpochHash,
    },
  ];
}

function buildContainerV2CreateRequest(input: {
  body: ContainerCreateAccessEventBodyV2;
  event: AccessEventV2;
  keyEpoch: ContainerKeyEpochV2;
  manifest: AccessManifestV2;
  manifestHash: string;
  parentKek: ContainerV2KekResponse;
  parentProjection: ContainerV2WriterProjectionResponse;
  wraps: readonly ContainerKeyWrapV2[];
}): ContainerV2MutationRequest {
  return {
    event: input.event as unknown as Record<string, unknown>,
    body: input.body as unknown as Record<string, unknown>,
    expectedManifestHash: input.manifestHash,
    manifest: input.manifest as unknown as Record<string, unknown>,
    previousManifest: null,
    parentContainerPath: input.parentProjection.path.map(
      asContainerV2ManifestBundle,
    ),
    principalPolicies: [],
    keyEpoch: input.keyEpoch as unknown as Record<string, unknown>,
    wraps: input.wraps.map(
      (wrap) => wrap as unknown as Record<string, unknown>,
    ),
    parentKekState: input.parentKek as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

export async function buildContainerV2CreatePlan({
  author,
  containerId = crypto.randomUUID(),
  containerKey,
  containerKeyEpochId = crypto.randomUUID(),
  eventId = crypto.randomUUID(),
  metadataDocumentId = crypto.randomUUID(),
  parentKekMaterial,
  parentProjection,
  signedAt = new Date().toISOString(),
}: BuildContainerV2CreatePlanInput): Promise<ContainerV2CreatePlan> {
  assertContainerV2CreatePlanInput({
    author,
    containerKey,
    parentKekMaterial,
    parentProjection,
  });
  const parent = getParentCreateContext(parentProjection);
  const body = buildContainerV2CreateBody({
    containerKeyEpochId,
    metadataDocumentId,
    parentContainerId: parentProjection.containerId,
    parentManifestHash: parent.manifest.manifestHash,
  });
  const { event, eventHash } = await signContainerV2CreateEvent({
    author,
    body,
    containerId,
    eventId,
    parentPath: parentProjection.path,
    signedAt,
  });
  const { manifest, manifestHash, state } =
    await deriveContainerV2CreateManifest({
      author,
      containerId,
      containerKeyEpochId,
      eventHash,
      metadataDocumentId,
      parentContainerId: parentProjection.containerId,
      parentManifestHash: parent.manifest.manifestHash,
    });
  const keyEpoch = buildContainerV2CreateKeyEpoch({
    containerId,
    containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: parent.kek.containerKeyEpochId,
  });
  const recipientTargets = buildParentRecipientTargets(parent.kek);
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const wraps = [
    await wrapContainerKeyToParent({
      containerKey,
      containerKeyEpochId,
      manifestHash,
      parentKek: parent.kek,
      parentKekMaterial,
    }),
  ];

  return {
    body,
    containerId,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId,
    parentContainerId: parentProjection.containerId,
    parentManifestHash: parent.manifest.manifestHash,
    recipientTargets,
    request: buildContainerV2CreateRequest({
      body,
      event,
      keyEpoch,
      manifest,
      manifestHash,
      parentKek: parent.kek,
      parentProjection,
      wraps,
    }),
    state,
    wraps,
  };
}

export async function buildMaterializedContainerV2CreatePlan(input: {
  author: ContainerV2MutationAuthor;
  containerId?: string | undefined;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  metadataDocumentId?: string | undefined;
  parentProjection: ContainerV2WriterProjectionResponse;
  parentSecretKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<MaterializedContainerV2CreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));

  const parent = getParentCreateContext(input.parentProjection);
  const parentKeksByEpochId = await unwrapContainerV2KekPath({
    execSql: input.execSql,
    projection: input.parentProjection,
    secretKey: input.parentSecretKey,
  });
  const parentKekMaterial = parentKeksByEpochId.get(
    parent.kek.containerKeyEpochId,
  );
  if (!parentKekMaterial) {
    throw new Error("Container V2 parent KEK could not be unwrapped");
  }

  const plan = await buildContainerV2CreatePlan({
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

export async function createRemoteContainerV2(input: {
  apiClient: ContainerV2CreateApi;
  author: ContainerV2MutationAuthor;
  containerId?: string | undefined;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  metadataDocumentId?: string | undefined;
  parentContainerId: string;
  parentSecretKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<CreateRemoteContainerV2Result | null> {
  const parentProjection = await input.apiClient.getContainerV2WriterProjection(
    input.parentContainerId,
  );
  if (!parentProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerV2CreatePlan({
    author: input.author,
    containerId: input.containerId,
    containerKey: input.containerKey,
    containerKeyEpochId: input.containerKeyEpochId,
    eventId: input.eventId,
    execSql: input.execSql,
    metadataDocumentId: input.metadataDocumentId,
    parentProjection,
    parentSecretKey: input.parentSecretKey,
    signedAt: input.signedAt,
  });
  const response = await input.apiClient.createContainerV2(
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
