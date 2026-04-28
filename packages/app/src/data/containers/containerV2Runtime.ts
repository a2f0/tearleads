import {
  type AccessEventV2,
  type AccessManifestV2,
  type ContainerAccessLevelV2,
  type ContainerAccessManifestStateV2,
  type ContainerCreateAccessEventBodyV2,
  type ContainerDirectGrantV2,
  type ContainerGrantAccessEventBodyV2,
  type ContainerKekRecipientTargetV2,
  type ContainerKeyEpochV2,
  type ContainerKeyWrapV2,
  type ContainerMoveAccessEventBodyV2,
  type ContainerUserRecipientKeyV2,
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
  wrapDekForRecipients,
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
  parentContainerId: string | null;
  parentManifestHash: string | null;
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

interface ContainerV2ShareApi {
  getContainerV2WriterProjection(
    containerId: string,
  ): Promise<ContainerV2WriterProjectionResponse | null>;
  shareContainerV2(
    containerId: string,
    input: ContainerV2MutationRequest,
  ): Promise<ContainerV2MutationResponse | null>;
}

interface ContainerV2MoveApi {
  getContainerV2WriterProjection(
    containerId: string,
  ): Promise<ContainerV2WriterProjectionResponse | null>;
  moveContainerV2(
    containerId: string,
    input: ContainerV2MutationRequest,
  ): Promise<ContainerV2MutationResponse | null>;
}

interface CreateRemoteContainerV2Result {
  containerKey: Uint8Array;
  containerId: string;
  metadataDocumentId: string;
  plan: ContainerV2CreatePlan;
  response: ContainerV2MutationResponse;
}

interface ContainerV2SharePlan {
  body: ContainerGrantAccessEventBodyV2;
  containerId: string;
  event: AccessEventV2;
  eventHash: string;
  grant: ContainerDirectGrantV2;
  keyEpoch: ContainerKeyEpochV2;
  manifest: AccessManifestV2;
  manifestHash: string;
  previousManifest: ContainerV2ManifestBundle;
  recipientTarget: ContainerKekRecipientTargetV2;
  request: ContainerV2MutationRequest;
  state: ContainerAccessManifestStateV2;
  userRecipientKey: ContainerUserRecipientKeyV2;
  wraps: ContainerKeyWrapV2[];
}

interface MaterializedContainerV2SharePlan {
  containerKey: Uint8Array;
  plan: ContainerV2SharePlan;
}

interface ContainerV2MovePlan {
  body: ContainerMoveAccessEventBodyV2;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEventV2;
  eventHash: string;
  keyEpoch: ContainerKeyEpochV2;
  manifest: AccessManifestV2;
  manifestHash: string;
  previousManifest: ContainerV2ManifestBundle;
  request: ContainerV2MutationRequest;
  state: ContainerAccessManifestStateV2;
  wraps: ContainerKeyWrapV2[];
}

interface MaterializedContainerV2MovePlan {
  containerKey: Uint8Array;
  plan: ContainerV2MovePlan;
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

function readContainerV2State(
  bundle: ContainerV2WriterProjectionResponse["path"][number],
): ContainerAccessManifestStateV2 {
  if (!isPlainObject(bundle.state)) {
    throw new Error("Container V2 manifest state is invalid");
  }

  return bundle.state as unknown as ContainerAccessManifestStateV2;
}

function getTargetContainerContext(
  projection: ContainerV2WriterProjectionResponse,
): ParentContainerCreateContext {
  if (projection.path.length !== projection.containerKeks.length) {
    throw new Error("Container V2 projection path and KEKs are inconsistent");
  }

  const manifest = projection.path.at(-1);
  const kek = projection.containerKeks.at(-1);
  if (!manifest || !kek) {
    throw new Error("Container V2 projection is empty");
  }
  if (readManifestContainerId(manifest) !== projection.containerId) {
    throw new Error("Container V2 projection target is inconsistent");
  }
  if (kek.containerId !== projection.containerId) {
    throw new Error("Container V2 target KEK is inconsistent");
  }
  if (kek.accessManifestHash !== manifest.manifestHash) {
    throw new Error("Container V2 target KEK is stale");
  }

  return { manifest, kek };
}

function getParentKekForTarget(
  projection: ContainerV2WriterProjectionResponse,
): ContainerV2KekResponse | null {
  const targetState = readContainerV2State(
    getTargetContainerContext(projection).manifest,
  );
  if (!targetState.parentContainerId) {
    return null;
  }

  const parentKek = projection.containerKeks.at(-2);
  if (!parentKek || parentKek.containerId !== targetState.parentContainerId) {
    throw new Error("Container V2 parent KEK is unavailable");
  }

  return parentKek;
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
  parentContainerId: string | null;
  parentManifestHash: string | null;
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

async function signContainerV2MutationEvent(input: {
  author: ContainerV2MutationAuthor;
  body: ContainerGrantAccessEventBodyV2 | ContainerMoveAccessEventBodyV2;
  containerId: string;
  dependencyManifestHashes: readonly string[];
  eventId: string;
  previousManifestHash: string;
  signedAt: string;
}): Promise<
  Pick<ContainerV2SharePlan | ContainerV2MovePlan, "event" | "eventHash">
> {
  const bodyHash = await computeAccessEventBodyHash(
    input.body as unknown as KeyingV2CanonicalJson,
  );
  const unsignedEvent: UnsignedAccessEventV2 = {
    version: 2,
    eventId: input.eventId,
    eventType: input.body.eventType,
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.author.organizationId,
    previousManifestHash: input.previousManifestHash,
    dependencyManifestHashes: [
      ...new Set(input.dependencyManifestHashes),
    ].sort(),
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
  parentContainerId: string | null;
  parentManifestHash: string | null;
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
  parentContainerKeyEpochId: string | null;
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

function buildRootContainerV2CreateRequest(input: {
  body: ContainerCreateAccessEventBodyV2;
  event: AccessEventV2;
  keyEpoch: ContainerKeyEpochV2;
  manifest: AccessManifestV2;
  manifestHash: string;
  userRecipientKeys: readonly ContainerUserRecipientKeyV2[];
  wraps: readonly ContainerKeyWrapV2[];
}): ContainerV2MutationRequest {
  return {
    event: input.event as unknown as Record<string, unknown>,
    body: input.body as unknown as Record<string, unknown>,
    expectedManifestHash: input.manifestHash,
    manifest: input.manifest as unknown as Record<string, unknown>,
    previousManifest: null,
    parentContainerPath: [],
    principalPolicies: [],
    keyEpoch: input.keyEpoch as unknown as Record<string, unknown>,
    wraps: input.wraps.map(
      (wrap) => wrap as unknown as Record<string, unknown>,
    ),
    userRecipientKeys: input.userRecipientKeys.map(
      (recipient) => recipient as unknown as Record<string, unknown>,
    ),
  };
}

async function wrapContainerKeyToRootUser(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  recipientEncapsulationPublicKey: Uint8Array;
  userId: string;
}): Promise<{
  recipientTarget: ContainerKekRecipientTargetV2;
  userRecipientKey: ContainerUserRecipientKeyV2;
  wrap: ContainerKeyWrapV2;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    input.recipientEncapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Container V2 root recipient wrap is unavailable");
  }

  const userRecipientKey: ContainerUserRecipientKeyV2 = {
    userId: input.userId,
    recipientKeyEpochId: `user:${input.userId}:encapsulation:${recipient.keyFingerprint}`,
    recipientKeyFingerprint: recipient.keyFingerprint,
  };
  const recipientTarget: ContainerKekRecipientTargetV2 = {
    recipientKind: "user",
    recipientId: input.userId,
    recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
    recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
  };

  return {
    recipientTarget,
    userRecipientKey,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: "user",
      recipientId: input.userId,
      recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}

async function deriveRootContainerV2CreateManifest(input: {
  author: ContainerV2MutationAuthor;
  body: ContainerCreateAccessEventBodyV2;
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  metadataDocumentId: string;
}): Promise<
  Pick<ContainerV2CreatePlan, "manifest" | "manifestHash" | "state">
> {
  const { state } = await deriveContainerV2CreateManifest({
    author: input.author,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    eventHash: input.eventHash,
    metadataDocumentId: input.metadataDocumentId,
    parentContainerId: null,
    parentManifestHash: null,
  });
  state.directGrants = input.body.directGrants;
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

function buildRootContainerV2CreateBody(input: {
  author: ContainerV2MutationAuthor;
  containerKeyEpochId: string;
  metadataDocumentId: string;
}): ContainerCreateAccessEventBodyV2 {
  return {
    ...buildContainerV2CreateBody({
      containerKeyEpochId: input.containerKeyEpochId,
      metadataDocumentId: input.metadataDocumentId,
      parentContainerId: null,
      parentManifestHash: null,
    }),
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: input.author.signerUserId,
        subjectType: "user",
      },
    ],
  };
}

export async function buildRootContainerV2CreatePlan(input: {
  author: ContainerV2MutationAuthor;
  containerId: string;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  metadataDocumentId: string;
  recipientEncapsulationPublicKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<MaterializedContainerV2CreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (containerKey.byteLength !== 32) {
    throw new Error("Container V2 KEK material must be 32 bytes");
  }

  const containerKeyEpochId = input.containerKeyEpochId ?? crypto.randomUUID();
  const body = buildRootContainerV2CreateBody({
    author: input.author,
    containerKeyEpochId,
    metadataDocumentId: input.metadataDocumentId,
  });
  const { event, eventHash } = await signContainerV2CreateEvent({
    author: input.author,
    body,
    containerId: input.containerId,
    eventId: input.eventId ?? crypto.randomUUID(),
    parentPath: [],
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } =
    await deriveRootContainerV2CreateManifest({
      author: input.author,
      body,
      containerId: input.containerId,
      containerKeyEpochId,
      eventHash,
      metadataDocumentId: input.metadataDocumentId,
    });
  const keyEpoch = buildContainerV2CreateKeyEpoch({
    containerId: input.containerId,
    containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: null,
  });
  const { recipientTarget, userRecipientKey, wrap } =
    await wrapContainerKeyToRootUser({
      containerKey,
      containerKeyEpochId,
      manifestHash,
      recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
      userId: input.author.signerUserId,
    });
  const recipientTargets = [recipientTarget];
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const plan: ContainerV2CreatePlan = {
    body,
    containerId: input.containerId,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    parentContainerId: null,
    parentManifestHash: null,
    recipientTargets,
    request: buildRootContainerV2CreateRequest({
      body,
      event,
      keyEpoch,
      manifest,
      manifestHash,
      userRecipientKeys: [userRecipientKey],
      wraps: [wrap],
    }),
    state,
    wraps: [wrap],
  };

  return { containerKey, plan };
}

export function rootContainerV2WriterProjectionFromCreatePlan(
  plan: ContainerV2CreatePlan,
): ContainerV2WriterProjectionResponse {
  return {
    containerId: plan.containerId,
    organizationId: plan.state.organizationId,
    path: [
      {
        event: {
          event: plan.event as unknown as Record<string, unknown>,
          body: plan.body as unknown as Record<string, unknown>,
          eventHash: plan.eventHash,
        },
        manifest: plan.manifest as unknown as Record<string, unknown>,
        manifestHash: plan.manifestHash,
        state: plan.state as unknown as Record<string, unknown>,
      },
    ],
    containerKeks: [
      {
        containerId: plan.containerId,
        accessManifestHash: plan.manifestHash,
        containerKeyEpochId: plan.containerKeyEpochId,
        containerKeyEpoch: plan.keyEpoch.keyEpoch,
        keyEpoch: plan.keyEpoch as unknown as Record<string, unknown>,
        keyEpochHash: plan.keyEpochHash,
        keyTargetHash: plan.keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: plan.recipientTargets.map(
          (target) => target as unknown as Record<string, unknown>,
        ),
        wraps: plan.wraps.map(
          (wrap) => wrap as unknown as Record<string, unknown>,
        ),
      },
    ],
  };
}

function grantKey(
  grant: Pick<ContainerDirectGrantV2, "subjectId" | "subjectType">,
): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

function upsertContainerGrant(
  grants: readonly ContainerDirectGrantV2[],
  grant: ContainerDirectGrantV2,
): ContainerDirectGrantV2[] {
  return [
    ...grants.filter(
      (existingGrant) => grantKey(existingGrant) !== grantKey(grant),
    ),
    grant,
  ].sort((left, right) => grantKey(left).localeCompare(grantKey(right)));
}

async function deriveContainerV2ShareManifest(input: {
  eventHash: string;
  grant: ContainerDirectGrantV2;
  previousManifest: ContainerV2WriterProjectionResponse["path"][number];
}): Promise<Pick<ContainerV2SharePlan, "manifest" | "manifestHash" | "state">> {
  const previousState = readContainerV2State(input.previousManifest);
  const state: ContainerAccessManifestStateV2 = {
    ...previousState,
    epoch: previousState.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash: input.eventHash,
    directGrants: upsertContainerGrant(previousState.directGrants, input.grant),
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

function buildContainerV2ShareRequest(input: {
  body: ContainerGrantAccessEventBodyV2;
  event: AccessEventV2;
  keyEpoch: ContainerKeyEpochV2;
  manifest: AccessManifestV2;
  manifestHash: string;
  parentKek: ContainerV2KekResponse | null;
  previousManifest: ContainerV2ManifestBundle;
  previousProjection: ContainerV2WriterProjectionResponse;
  userRecipientKey: ContainerUserRecipientKeyV2;
  wraps: readonly ContainerKeyWrapV2[];
}): ContainerV2MutationRequest {
  return {
    event: input.event as unknown as Record<string, unknown>,
    body: input.body as unknown as Record<string, unknown>,
    expectedManifestHash: input.manifestHash,
    manifest: input.manifest as unknown as Record<string, unknown>,
    previousManifest: input.previousManifest,
    previousContainerPath: input.previousProjection.path.map(
      asContainerV2ManifestBundle,
    ),
    containerManifestHistory: [input.previousManifest],
    principalPolicies: [],
    keyEpoch: input.keyEpoch as unknown as Record<string, unknown>,
    wraps: input.wraps.map(
      (wrap) => wrap as unknown as Record<string, unknown>,
    ),
    parentKekState: input.parentKek as unknown as Record<
      string,
      unknown
    > | null,
    userRecipientKeys: [
      input.userRecipientKey as unknown as Record<string, unknown>,
    ],
  };
}

function replaceContainerWrap(
  wraps: readonly ContainerKeyWrapV2[],
  nextWrap: ContainerKeyWrapV2,
): ContainerKeyWrapV2[] {
  return [
    ...wraps.filter(
      (wrap) =>
        !(
          wrap.recipientKind === nextWrap.recipientKind &&
          wrap.recipientId === nextWrap.recipientId &&
          wrap.recipientKeyEpochId === nextWrap.recipientKeyEpochId
        ),
    ),
    nextWrap,
  ];
}

function buildContainerV2SharePlanResult(input: {
  body: ContainerGrantAccessEventBodyV2;
  containerId: string;
  containerKey: Uint8Array;
  event: AccessEventV2;
  eventHash: string;
  grant: ContainerDirectGrantV2;
  manifest: AccessManifestV2;
  manifestHash: string;
  previousManifest: ContainerV2ManifestBundle;
  previousProjection: ContainerV2WriterProjectionResponse;
  recipientTarget: ContainerKekRecipientTargetV2;
  state: ContainerAccessManifestStateV2;
  targetKek: ContainerV2KekResponse;
  userRecipientKey: ContainerUserRecipientKeyV2;
  wraps: ContainerKeyWrapV2[];
}): MaterializedContainerV2SharePlan {
  const keyEpoch = input.targetKek.keyEpoch as unknown as ContainerKeyEpochV2;
  const plan: ContainerV2SharePlan = {
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
    request: buildContainerV2ShareRequest({
      body: input.body,
      event: input.event,
      keyEpoch,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      parentKek: getParentKekForTarget(input.previousProjection),
      previousManifest: input.previousManifest,
      previousProjection: input.previousProjection,
      userRecipientKey: input.userRecipientKey,
      wraps: input.wraps,
    }),
    state: input.state,
    userRecipientKey: input.userRecipientKey,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}

async function buildMaterializedContainerV2SharePlan(input: {
  accessLevel: ContainerAccessLevelV2;
  author: ContainerV2MutationAuthor;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  previousProjection: ContainerV2WriterProjectionResponse;
  recipientEncapsulationPublicKey: Uint8Array;
  recipientUserId: string;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<MaterializedContainerV2SharePlan> {
  const target = getTargetContainerContext(input.previousProjection);
  const previousState = readContainerV2State(target.manifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error("Container V2 share author organization mismatch");
  }

  const grant: ContainerDirectGrantV2 = {
    accessLevel: input.accessLevel,
    subjectId: input.recipientUserId,
    subjectType: "user",
  };
  const body: ContainerGrantAccessEventBodyV2 = {
    eventType: "container.grant",
    containerKeyEpochId: previousState.containerKeyEpochId,
    grant,
    referencedPrincipalHead: null,
  };
  const { event, eventHash } = await signContainerV2MutationEvent({
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
  const { manifest, manifestHash, state } =
    await deriveContainerV2ShareManifest({
      eventHash,
      grant,
      previousManifest: target.manifest,
    });
  const keksByEpochId = await unwrapContainerV2KekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
  });
  const containerKey = keksByEpochId.get(target.kek.containerKeyEpochId);
  if (!containerKey) {
    throw new Error("Container V2 share target KEK could not be unwrapped");
  }
  const { recipientTarget, userRecipientKey, wrap } =
    await wrapContainerKeyToRootUser({
      containerKey,
      containerKeyEpochId: target.kek.containerKeyEpochId,
      manifestHash,
      recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
      userId: input.recipientUserId,
    });
  const previousWraps = target.kek.wraps as unknown as ContainerKeyWrapV2[];
  return buildContainerV2SharePlanResult({
    body,
    containerKey,
    containerId: previousState.containerId,
    event,
    eventHash,
    grant,
    manifest,
    manifestHash,
    previousManifest: asContainerV2ManifestBundle(target.manifest),
    recipientTarget,
    previousProjection: input.previousProjection,
    state,
    targetKek: target.kek,
    userRecipientKey,
    wraps: replaceContainerWrap(previousWraps, wrap),
  });
}

export async function shareRemoteContainerV2(input: {
  accessLevel: ContainerAccessLevelV2;
  apiClient: ContainerV2ShareApi;
  author: ContainerV2MutationAuthor;
  containerId: string;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  recipientEncapsulationPublicKey: Uint8Array;
  recipientUserId: string;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerV2SharePlan;
  response: ContainerV2MutationResponse;
} | null> {
  const previousProjection =
    await input.apiClient.getContainerV2WriterProjection(input.containerId);
  if (!previousProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerV2SharePlan({
    accessLevel: input.accessLevel,
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    previousProjection,
    recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
    recipientUserId: input.recipientUserId,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
  });
  const response = await input.apiClient.shareContainerV2(
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

async function deriveContainerV2MoveManifest(input: {
  containerKeyEpochId: string;
  destinationParent: ContainerV2WriterProjectionResponse["path"][number];
  eventHash: string;
  previousManifest: ContainerV2WriterProjectionResponse["path"][number];
}): Promise<Pick<ContainerV2MovePlan, "manifest" | "manifestHash" | "state">> {
  const previousState = readContainerV2State(input.previousManifest);
  const destinationState = readContainerV2State(input.destinationParent);
  const state: ContainerAccessManifestStateV2 = {
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

function buildContainerV2MoveRequest(input: {
  body: ContainerMoveAccessEventBodyV2;
  destinationParentKek: ContainerV2KekResponse;
  destinationParentProjection: ContainerV2WriterProjectionResponse;
  event: AccessEventV2;
  keyEpoch: ContainerKeyEpochV2;
  manifest: AccessManifestV2;
  manifestHash: string;
  previousManifest: ContainerV2ManifestBundle;
  previousProjection: ContainerV2WriterProjectionResponse;
  wraps: readonly ContainerKeyWrapV2[];
}): ContainerV2MutationRequest {
  return {
    event: input.event as unknown as Record<string, unknown>,
    body: input.body as unknown as Record<string, unknown>,
    expectedManifestHash: input.manifestHash,
    manifest: input.manifest as unknown as Record<string, unknown>,
    previousManifest: input.previousManifest,
    previousContainerPath: input.previousProjection.path.map(
      asContainerV2ManifestBundle,
    ),
    destinationParentContainerPath: input.destinationParentProjection.path.map(
      asContainerV2ManifestBundle,
    ),
    principalPolicies: [],
    keyEpoch: input.keyEpoch as unknown as Record<string, unknown>,
    wraps: input.wraps.map(
      (wrap) => wrap as unknown as Record<string, unknown>,
    ),
    parentKekState: input.destinationParentKek as unknown as Record<
      string,
      unknown
    >,
    userRecipientKeys: [],
  };
}

async function unwrapMoveContainerKeys(input: {
  destinationParentKek: ContainerV2KekResponse;
  destinationParentProjection: ContainerV2WriterProjectionResponse;
  execSql?: ExecSql | undefined;
  previousProjection: ContainerV2WriterProjectionResponse;
  sourceKek: ContainerV2KekResponse;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  destinationParentKey: Uint8Array;
}> {
  const keksByEpochId = await unwrapContainerV2KekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
  });
  const containerKey = keksByEpochId.get(input.sourceKek.containerKeyEpochId);
  if (!containerKey) {
    throw new Error("Container V2 move source KEK could not be unwrapped");
  }

  const destinationKeksByEpochId = await unwrapContainerV2KekPath({
    execSql: input.execSql,
    projection: input.destinationParentProjection,
    secretKey: input.targetSecretKey,
  });
  const destinationParentKey = destinationKeksByEpochId.get(
    input.destinationParentKek.containerKeyEpochId,
  );
  if (!destinationParentKey) {
    throw new Error(
      "Container V2 move destination parent KEK could not be unwrapped",
    );
  }

  return { containerKey, destinationParentKey };
}

function buildContainerV2MovePlanResult(input: {
  body: ContainerMoveAccessEventBodyV2;
  containerId: string;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  destinationParentKek: ContainerV2KekResponse;
  destinationParentProjection: ContainerV2WriterProjectionResponse;
  event: AccessEventV2;
  eventHash: string;
  keyEpoch: ContainerKeyEpochV2;
  manifest: AccessManifestV2;
  manifestHash: string;
  previousManifest: ContainerV2ManifestBundle;
  previousProjection: ContainerV2WriterProjectionResponse;
  state: ContainerAccessManifestStateV2;
  wraps: ContainerKeyWrapV2[];
}): MaterializedContainerV2MovePlan {
  const plan: ContainerV2MovePlan = {
    body: input.body,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    event: input.event,
    eventHash: input.eventHash,
    keyEpoch: input.keyEpoch,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    previousManifest: input.previousManifest,
    request: buildContainerV2MoveRequest({
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

async function buildMaterializedContainerV2MovePlan(input: {
  author: ContainerV2MutationAuthor;
  containerKeyEpochId?: string | undefined;
  destinationParentProjection: ContainerV2WriterProjectionResponse;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  previousProjection: ContainerV2WriterProjectionResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<MaterializedContainerV2MovePlan> {
  const source = getTargetContainerContext(input.previousProjection);
  const destinationParent = getTargetContainerContext(
    input.destinationParentProjection,
  );
  const previousState = readContainerV2State(source.manifest);
  const destinationState = readContainerV2State(destinationParent.manifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error("Container V2 move author organization mismatch");
  }
  if (destinationState.organizationId !== input.author.organizationId) {
    throw new Error("Container V2 move destination organization mismatch");
  }

  const containerKeyEpochId = input.containerKeyEpochId ?? crypto.randomUUID();
  const body: ContainerMoveAccessEventBodyV2 = {
    eventType: "container.move",
    parentContainerId: destinationState.containerId,
    parentManifestHash: destinationParent.manifest.manifestHash,
    containerKeyEpochId,
  };
  const { event, eventHash } = await signContainerV2MutationEvent({
    author: input.author,
    body,
    containerId: previousState.containerId,
    dependencyManifestHashes: [
      ...uniqueSortedManifestHashes(input.previousProjection.path),
      ...uniqueSortedManifestHashes(input.destinationParentProjection.path),
    ],
    eventId: input.eventId ?? crypto.randomUUID(),
    previousManifestHash: source.manifest.manifestHash,
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } = await deriveContainerV2MoveManifest(
    {
      containerKeyEpochId,
      destinationParent: destinationParent.manifest,
      eventHash,
      previousManifest: source.manifest,
    },
  );
  const { containerKey, destinationParentKey } = await unwrapMoveContainerKeys({
    destinationParentKek: destinationParent.kek,
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    sourceKek: source.kek,
    targetSecretKey: input.targetSecretKey,
  });
  const keyEpoch = buildContainerV2CreateKeyEpoch({
    containerId: previousState.containerId,
    containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: destinationParent.kek.containerKeyEpochId,
  });
  keyEpoch.keyEpoch = source.kek.containerKeyEpoch + 1;
  const wraps = [
    await wrapContainerKeyToParent({
      containerKey,
      containerKeyEpochId,
      manifestHash,
      parentKek: destinationParent.kek,
      parentKekMaterial: destinationParentKey,
    }),
  ];
  return buildContainerV2MovePlanResult({
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
    previousManifest: asContainerV2ManifestBundle(source.manifest),
    previousProjection: input.previousProjection,
    state,
    wraps,
  });
}

export async function moveRemoteContainerV2(input: {
  apiClient: ContainerV2MoveApi;
  author: ContainerV2MutationAuthor;
  containerId: string;
  destinationParentContainerId: string;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerV2MovePlan;
  response: ContainerV2MutationResponse;
} | null> {
  const [previousProjection, destinationParentProjection] = await Promise.all([
    input.apiClient.getContainerV2WriterProjection(input.containerId),
    input.apiClient.getContainerV2WriterProjection(
      input.destinationParentContainerId,
    ),
  ]);
  if (!previousProjection || !destinationParentProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerV2MovePlan({
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    previousProjection,
    destinationParentProjection,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
  });
  const response = await input.apiClient.moveContainerV2(
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
