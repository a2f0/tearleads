import {
  type AccessEvent,
  type AccessManifest,
  type ContainerAccessLevel,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerDirectGrant,
  type ContainerGrantAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerMoveAccessEventBody,
  type ContainerUserRecipientKey,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  encryptWithDek,
  signAccessEvent,
  type UnsignedAccessEvent,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type {
  ContainerManifestBundle,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { unwrapContainerKekPath } from "../documents/documentRuntime";
import {
  readCanonicalJson,
  readCanonicalRecord,
  readCanonicalRecords,
} from "../keyingCanonicalJson";
import type { ExecSql } from "../persistence/sqlSchema";

export interface ContainerMutationAuthor {
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

interface BuildContainerCreatePlanInput {
  author: ContainerMutationAuthor;
  containerId?: string | undefined;
  containerKey: Uint8Array;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  metadataDocumentId?: string | undefined;
  parentKekMaterial: Uint8Array;
  parentProjection: ContainerWriterProjectionResponse;
  signedAt?: string | undefined;
}

interface ContainerCreatePlan {
  body: ContainerCreateAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyEpochHash: string;
  keyTargetHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  metadataDocumentId: string;
  parentContainerId: string | null;
  parentManifestHash: string | null;
  recipientTargets: ContainerKekRecipientTarget[];
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  wraps: ContainerKeyWrap[];
}

interface MaterializedContainerCreatePlan {
  containerKey: Uint8Array;
  plan: ContainerCreatePlan;
}

interface ContainerCreateApi {
  createContainer(
    input: ContainerMutationRequest,
  ): Promise<ContainerMutationResponse | null>;
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
}

interface ContainerShareApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  shareContainer(
    containerId: string,
    input: ContainerMutationRequest,
  ): Promise<ContainerMutationResponse | null>;
}

interface ContainerMoveApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  moveContainer(
    containerId: string,
    input: ContainerMutationRequest,
  ): Promise<ContainerMutationResponse | null>;
}

interface CreateRemoteContainerResult {
  containerKey: Uint8Array;
  containerId: string;
  metadataDocumentId: string;
  plan: ContainerCreatePlan;
  response: ContainerMutationResponse;
}

interface ContainerSharePlan {
  body: ContainerGrantAccessEventBody;
  containerId: string;
  event: AccessEvent;
  eventHash: string;
  grant: ContainerDirectGrant;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: ContainerManifestBundle;
  recipientTarget: ContainerKekRecipientTarget;
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  userRecipientKey: ContainerUserRecipientKey;
  wraps: ContainerKeyWrap[];
}

interface MaterializedContainerSharePlan {
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
}

interface ContainerMovePlan {
  body: ContainerMoveAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: ContainerManifestBundle;
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  wraps: ContainerKeyWrap[];
}

interface MaterializedContainerMovePlan {
  containerKey: Uint8Array;
  plan: ContainerMovePlan;
}

interface ParentContainerCreateContext {
  manifest: ContainerWriterProjectionResponse["path"][number];
  kek: ContainerKekResponse;
}

function readRecordValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return Reflect.get(record, key);
}

function readRecordString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readRecordValue(record, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function readRecordNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = readRecordValue(record, key);
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string or null`);
  }
  return value;
}

function readRecordPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = readRecordValue(record, key);
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}.${key} must be a positive integer`);
  }
  return value;
}

function readRecordVersion(
  record: Record<string, unknown>,
  label: string,
): void {
  if (readRecordPositiveInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
}

function readCanonicalManifestBundle(
  value: unknown,
  label: string,
): ContainerManifestBundle {
  const record = readCanonicalRecord(value, label);
  return {
    event: readCanonicalRecord(
      readRecordValue(record, "event"),
      `${label}.event`,
    ),
    manifest: readCanonicalRecord(
      readRecordValue(record, "manifest"),
      `${label}.manifest`,
    ),
    manifestHash: readRecordString(record, "manifestHash", label),
    state: readCanonicalRecord(
      readRecordValue(record, "state"),
      `${label}.state`,
    ),
  };
}

function isContainerAccessLevel(
  value: unknown,
): value is ContainerDirectGrant["accessLevel"] {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerDirectGrant["subjectType"] {
  return value === "group" || value === "organization" || value === "user";
}

function isManagedPrincipalKind(
  value: unknown,
): value is ContainerAccessManifestState["referencedPrincipalHeads"][number]["principalType"] {
  return value === "group" || value === "organization";
}

function isKekRecipientKind(
  value: unknown,
): value is ContainerKeyWrap["recipientKind"] {
  return (
    value === "container" ||
    value === "group" ||
    value === "organization" ||
    value === "user"
  );
}

function readContainerDirectGrant(
  value: unknown,
  label: string,
): ContainerDirectGrant {
  const record = readCanonicalRecord(value, label);
  const accessLevel = readRecordValue(record, "accessLevel");
  const subjectType = readRecordValue(record, "subjectType");
  if (!isContainerAccessLevel(accessLevel)) {
    throw new Error(`${label}.accessLevel is invalid`);
  }
  if (!isContainerGrantSubjectType(subjectType)) {
    throw new Error(`${label}.subjectType is invalid`);
  }

  return {
    accessLevel,
    subjectId: readRecordString(record, "subjectId", label),
    subjectType,
  };
}

function readContainerDirectGrants(
  value: unknown,
  label: string,
): ContainerDirectGrant[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((grant, index) =>
    readContainerDirectGrant(grant, `${label}[${index}]`),
  );
}

function readReferencedPrincipalHead(
  value: unknown,
  label: string,
): ContainerAccessManifestState["referencedPrincipalHeads"][number] {
  const record = readCanonicalRecord(value, label);
  const principalType = readRecordValue(record, "principalType");
  if (!isManagedPrincipalKind(principalType)) {
    throw new Error(`${label}.principalType is invalid`);
  }

  return {
    principalType,
    principalId: readRecordString(record, "principalId", label),
    version: readRecordPositiveInteger(record, "version", label),
    keyEpoch: readRecordPositiveInteger(record, "keyEpoch", label),
    stateHash: readRecordString(record, "stateHash", label),
    keyFingerprint: readRecordString(record, "keyFingerprint", label),
  };
}

function readReferencedPrincipalHeads(
  value: unknown,
  label: string,
): ContainerAccessManifestState["referencedPrincipalHeads"] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((head, index) =>
    readReferencedPrincipalHead(head, `${label}[${index}]`),
  );
}

function readContainerAccessManifestState(
  value: unknown,
  label: string,
): ContainerAccessManifestState {
  const record = readCanonicalRecord(value, label);
  readRecordVersion(record, label);

  return {
    version: 1,
    containerId: readRecordString(record, "containerId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordPositiveInteger(record, "epoch", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    eventHash: readRecordString(record, "eventHash", label),
    parentContainerId: readRecordNullableString(
      record,
      "parentContainerId",
      label,
    ),
    parentManifestHash: readRecordNullableString(
      record,
      "parentManifestHash",
      label,
    ),
    metadataDocumentId: readRecordString(record, "metadataDocumentId", label),
    containerKeyEpochId: readRecordNullableString(
      record,
      "containerKeyEpochId",
      label,
    ),
    directGrants: readContainerDirectGrants(
      readRecordValue(record, "directGrants"),
      `${label}.directGrants`,
    ),
    referencedPrincipalHeads: readReferencedPrincipalHeads(
      readRecordValue(record, "referencedPrincipalHeads"),
      `${label}.referencedPrincipalHeads`,
    ),
  };
}

function readContainerKeyEpoch(
  value: unknown,
  label: string,
): ContainerKeyEpoch {
  const record = readCanonicalRecord(value, label);
  return {
    id: readRecordString(record, "id", label),
    containerId: readRecordString(record, "containerId", label),
    keyEpoch: readRecordPositiveInteger(record, "keyEpoch", label),
    accessManifestHash: readRecordString(record, "accessManifestHash", label),
    parentContainerKeyEpochId: readRecordNullableString(
      record,
      "parentContainerKeyEpochId",
      label,
    ),
    createdByEventHash: readRecordString(record, "createdByEventHash", label),
    createdByManifestHash: readRecordString(
      record,
      "createdByManifestHash",
      label,
    ),
  };
}

function readContainerKeyWrap(value: unknown, label: string): ContainerKeyWrap {
  const record = readCanonicalRecord(value, label);
  const recipientKind = readRecordValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw new Error(`${label}.recipientKind is invalid`);
  }

  return {
    containerKeyEpochId: readRecordString(record, "containerKeyEpochId", label),
    recipientKind,
    recipientId: readRecordString(record, "recipientId", label),
    recipientKeyEpochId: readRecordString(record, "recipientKeyEpochId", label),
    recipientKeyFingerprint: readRecordString(
      record,
      "recipientKeyFingerprint",
      label,
    ),
    kemCipherText: readRecordString(record, "kemCipherText", label),
    wrappedKey: readRecordString(record, "wrappedKey", label),
    wrapManifestHash: readRecordString(record, "wrapManifestHash", label),
  };
}

function readContainerKeyWraps(
  value: unknown,
  label: string,
): ContainerKeyWrap[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((wrap, index) =>
    readContainerKeyWrap(wrap, `${label}[${index}]`),
  );
}

function readManifestContainerId(
  bundle: ContainerWriterProjectionResponse["path"][number],
): string | null {
  const containerId = isPlainObject(bundle.state)
    ? Reflect.get(bundle.state, "containerId")
    : undefined;

  return typeof containerId === "string" && containerId.length > 0
    ? containerId
    : null;
}

function uniqueSortedManifestHashes(
  path: readonly ContainerWriterProjectionResponse["path"][number][],
): string[] {
  return [...new Set(path.map((bundle) => bundle.manifestHash))].sort();
}

function getParentCreateContext(
  parentProjection: ContainerWriterProjectionResponse,
): ParentContainerCreateContext {
  if (parentProjection.path.length !== parentProjection.containerKeks.length) {
    throw new Error(
      "Container parent projection path and KEKs are inconsistent",
    );
  }

  const manifest = parentProjection.path.at(-1);
  const kek = parentProjection.containerKeks.at(-1);
  if (!manifest || !kek) {
    throw new Error("Container parent projection is empty");
  }
  if (readManifestContainerId(manifest) !== parentProjection.containerId) {
    throw new Error("Container parent projection target is inconsistent");
  }
  if (kek.containerId !== parentProjection.containerId) {
    throw new Error("Container parent KEK target is inconsistent");
  }
  if (kek.accessManifestHash !== manifest.manifestHash) {
    throw new Error("Container parent KEK is stale");
  }

  return { manifest, kek };
}

function asContainerManifestBundle(
  bundle: ContainerWriterProjectionResponse["path"][number],
): ContainerManifestBundle {
  return readCanonicalManifestBundle(bundle, "Container manifest bundle");
}

function readContainerState(
  bundle: ContainerWriterProjectionResponse["path"][number],
): ContainerAccessManifestState {
  return readContainerAccessManifestState(
    bundle.state,
    "Container manifest state",
  );
}

function getTargetContainerContext(
  projection: ContainerWriterProjectionResponse,
): ParentContainerCreateContext {
  if (projection.path.length !== projection.containerKeks.length) {
    throw new Error("Container projection path and KEKs are inconsistent");
  }

  const manifest = projection.path.at(-1);
  const kek = projection.containerKeks.at(-1);
  if (!manifest || !kek) {
    throw new Error("Container projection is empty");
  }
  if (readManifestContainerId(manifest) !== projection.containerId) {
    throw new Error("Container projection target is inconsistent");
  }
  if (kek.containerId !== projection.containerId) {
    throw new Error("Container target KEK is inconsistent");
  }
  if (kek.accessManifestHash !== manifest.manifestHash) {
    throw new Error("Container target KEK is stale");
  }

  return { manifest, kek };
}

function getParentKekForTarget(
  projection: ContainerWriterProjectionResponse,
): ContainerKekResponse | null {
  const targetState = readContainerState(
    getTargetContainerContext(projection).manifest,
  );
  if (!targetState.parentContainerId) {
    return null;
  }

  const parentKek = projection.containerKeks.at(-2);
  if (!parentKek || parentKek.containerId !== targetState.parentContainerId) {
    throw new Error("Container parent KEK is unavailable");
  }

  return parentKek;
}

async function wrapContainerKeyToParent(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  parentKek: ContainerKekResponse;
  parentKekMaterial: Uint8Array;
}): Promise<ContainerKeyWrap> {
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

function buildContainerCreateBody(input: {
  containerKeyEpochId: string;
  metadataDocumentId: string;
  parentContainerId: string | null;
  parentManifestHash: string | null;
}): ContainerCreateAccessEventBody {
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

async function signContainerCreateEvent(input: {
  author: ContainerMutationAuthor;
  body: ContainerCreateAccessEventBody;
  containerId: string;
  eventId: string;
  parentPath: ContainerWriterProjectionResponse["path"];
  signedAt: string;
}): Promise<Pick<ContainerCreatePlan, "event" | "eventHash">> {
  const bodyHash = await computeAccessEventBodyHash(
    readCanonicalJson(input.body, "Container create body"),
  );
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
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

async function signContainerMutationEvent(input: {
  author: ContainerMutationAuthor;
  body: ContainerGrantAccessEventBody | ContainerMoveAccessEventBody;
  containerId: string;
  dependencyManifestHashes: readonly string[];
  eventId: string;
  previousManifestHash: string;
  signedAt: string;
}): Promise<
  Pick<ContainerSharePlan | ContainerMovePlan, "event" | "eventHash">
> {
  const bodyHash = await computeAccessEventBodyHash(
    readCanonicalJson(input.body, "Container mutation body"),
  );
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
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

async function deriveContainerCreateManifest(input: {
  author: ContainerMutationAuthor;
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  metadataDocumentId: string;
  parentContainerId: string | null;
  parentManifestHash: string | null;
}): Promise<Pick<ContainerCreatePlan, "manifest" | "manifestHash" | "state">> {
  const state: ContainerAccessManifestState = {
    version: 1,
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

function buildContainerCreateKeyEpoch(input: {
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  manifestHash: string;
  parentContainerKeyEpochId: string | null;
}): ContainerKeyEpoch {
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
  parentKek: ContainerKekResponse,
): ContainerKekRecipientTarget[] {
  return [
    {
      recipientKind: "container",
      recipientId: parentKek.containerId,
      recipientKeyEpochId: parentKek.containerKeyEpochId,
      recipientKeyFingerprint: parentKek.keyEpochHash,
    },
  ];
}

function buildContainerCreateRequest(input: {
  body: ContainerCreateAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse;
  parentProjection: ContainerWriterProjectionResponse;
  wraps: readonly ContainerKeyWrap[];
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

function buildRootContainerCreateRequest(input: {
  body: ContainerCreateAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    event: readCanonicalRecord(input.event, "Container root create event"),
    body: readCanonicalRecord(input.body, "Container root create body"),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(
      input.manifest,
      "Container root create manifest",
    ),
    previousManifest: null,
    parentContainerPath: [],
    principalPolicies: [],
    keyEpoch: readCanonicalRecord(
      input.keyEpoch,
      "Container root create key epoch",
    ),
    wraps: readCanonicalRecords(input.wraps, "Container root create wraps"),
    userRecipientKeys: readCanonicalRecords(
      input.userRecipientKeys,
      "Container root create user recipient keys",
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
  recipientTarget: ContainerKekRecipientTarget;
  userRecipientKey: ContainerUserRecipientKey;
  wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    input.recipientEncapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Container root recipient wrap is unavailable");
  }

  const userRecipientKey: ContainerUserRecipientKey = {
    userId: input.userId,
    recipientKeyEpochId: `user:${input.userId}:encapsulation:${recipient.keyFingerprint}`,
    recipientKeyFingerprint: recipient.keyFingerprint,
  };
  const recipientTarget: ContainerKekRecipientTarget = {
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

async function deriveRootContainerCreateManifest(input: {
  author: ContainerMutationAuthor;
  body: ContainerCreateAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  metadataDocumentId: string;
}): Promise<Pick<ContainerCreatePlan, "manifest" | "manifestHash" | "state">> {
  const { state } = await deriveContainerCreateManifest({
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

function buildRootContainerCreateBody(input: {
  author: ContainerMutationAuthor;
  containerKeyEpochId: string;
  metadataDocumentId: string;
}): ContainerCreateAccessEventBody {
  return {
    ...buildContainerCreateBody({
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

export async function buildRootContainerCreatePlan(input: {
  author: ContainerMutationAuthor;
  containerId: string;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  metadataDocumentId: string;
  recipientEncapsulationPublicKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<MaterializedContainerCreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (containerKey.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }

  const containerKeyEpochId = input.containerKeyEpochId ?? crypto.randomUUID();
  const body = buildRootContainerCreateBody({
    author: input.author,
    containerKeyEpochId,
    metadataDocumentId: input.metadataDocumentId,
  });
  const { event, eventHash } = await signContainerCreateEvent({
    author: input.author,
    body,
    containerId: input.containerId,
    eventId: input.eventId ?? crypto.randomUUID(),
    parentPath: [],
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } =
    await deriveRootContainerCreateManifest({
      author: input.author,
      body,
      containerId: input.containerId,
      containerKeyEpochId,
      eventHash,
      metadataDocumentId: input.metadataDocumentId,
    });
  const keyEpoch = buildContainerCreateKeyEpoch({
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
  const plan: ContainerCreatePlan = {
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
    request: buildRootContainerCreateRequest({
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

export function rootContainerWriterProjectionFromCreatePlan(
  plan: ContainerCreatePlan,
): ContainerWriterProjectionResponse {
  return {
    containerId: plan.containerId,
    organizationId: plan.state.organizationId,
    path: [
      {
        event: {
          event: readCanonicalRecord(plan.event, "Container root event"),
          body: readCanonicalRecord(plan.body, "Container root body"),
          eventHash: plan.eventHash,
        },
        manifest: readCanonicalRecord(plan.manifest, "Container root manifest"),
        manifestHash: plan.manifestHash,
        state: readCanonicalRecord(plan.state, "Container root state"),
      },
    ],
    containerKeks: [
      {
        containerId: plan.containerId,
        accessManifestHash: plan.manifestHash,
        containerKeyEpochId: plan.containerKeyEpochId,
        containerKeyEpoch: plan.keyEpoch.keyEpoch,
        keyEpoch: readCanonicalRecord(
          plan.keyEpoch,
          "Container root key epoch",
        ),
        keyEpochHash: plan.keyEpochHash,
        keyTargetHash: plan.keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: readCanonicalRecords(
          plan.recipientTargets,
          "Container root recipient targets",
        ),
        wraps: readCanonicalRecords(plan.wraps, "Container root wraps"),
      },
    ],
  };
}

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

async function deriveContainerShareManifest(input: {
  eventHash: string;
  grant: ContainerDirectGrant;
  previousManifest: ContainerWriterProjectionResponse["path"][number];
}): Promise<Pick<ContainerSharePlan, "manifest" | "manifestHash" | "state">> {
  const previousState = readContainerState(input.previousManifest);
  const state: ContainerAccessManifestState = {
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

function buildContainerShareRequest(input: {
  body: ContainerGrantAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse | null;
  previousManifest: ContainerManifestBundle;
  previousProjection: ContainerWriterProjectionResponse;
  userRecipientKey: ContainerUserRecipientKey;
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
    principalPolicies: [],
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
      [input.userRecipientKey],
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
          wrap.recipientId === nextWrap.recipientId &&
          wrap.recipientKeyEpochId === nextWrap.recipientKeyEpochId
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
  recipientTarget: ContainerKekRecipientTarget;
  state: ContainerAccessManifestState;
  targetKek: ContainerKekResponse;
  userRecipientKey: ContainerUserRecipientKey;
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
      userRecipientKey: input.userRecipientKey,
      wraps: input.wraps,
    }),
    state: input.state,
    userRecipientKey: input.userRecipientKey,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}

async function buildMaterializedContainerSharePlan(input: {
  accessLevel: ContainerAccessLevel;
  author: ContainerMutationAuthor;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  recipientEncapsulationPublicKey: Uint8Array;
  recipientUserId: string;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<MaterializedContainerSharePlan> {
  const target = getTargetContainerContext(input.previousProjection);
  const previousState = readContainerState(target.manifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error("Container share author organization mismatch");
  }

  const grant: ContainerDirectGrant = {
    accessLevel: input.accessLevel,
    subjectId: input.recipientUserId,
    subjectType: "user",
  };
  const body: ContainerGrantAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previousState.containerKeyEpochId,
    grant,
    referencedPrincipalHead: null,
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
  });
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
  });
  const containerKey = keksByEpochId.get(target.kek.containerKeyEpochId);
  if (!containerKey) {
    throw new Error("Container share target KEK could not be unwrapped");
  }
  const { recipientTarget, userRecipientKey, wrap } =
    await wrapContainerKeyToRootUser({
      containerKey,
      containerKeyEpochId: target.kek.containerKeyEpochId,
      manifestHash,
      recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
      userId: input.recipientUserId,
    });
  const previousWraps = readContainerKeyWraps(
    target.kek.wraps,
    "Container share previous wraps",
  );
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
    recipientTarget,
    previousProjection: input.previousProjection,
    state,
    targetKek: target.kek,
    userRecipientKey,
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
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
  response: ContainerMutationResponse;
} | null> {
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
    recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
    recipientUserId: input.recipientUserId,
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

async function unwrapMoveContainerKeys(input: {
  destinationParentKek: ContainerKekResponse;
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql?: ExecSql | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  sourceKek: ContainerKekResponse;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  destinationParentKey: Uint8Array;
}> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
  });
  const containerKey = keksByEpochId.get(input.sourceKek.containerKeyEpochId);
  if (!containerKey) {
    throw new Error("Container move source KEK could not be unwrapped");
  }

  const destinationKeksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.destinationParentProjection,
    secretKey: input.targetSecretKey,
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

async function buildMaterializedContainerMovePlan(input: {
  author: ContainerMutationAuthor;
  containerKeyEpochId?: string | undefined;
  destinationParentProjection: ContainerWriterProjectionResponse;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<MaterializedContainerMovePlan> {
  const source = getTargetContainerContext(input.previousProjection);
  const destinationParent = getTargetContainerContext(
    input.destinationParentProjection,
  );
  const previousState = readContainerState(source.manifest);
  const destinationState = readContainerState(destinationParent.manifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error("Container move author organization mismatch");
  }
  if (destinationState.organizationId !== input.author.organizationId) {
    throw new Error("Container move destination organization mismatch");
  }

  const containerKeyEpochId = input.containerKeyEpochId ?? crypto.randomUUID();
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
    dependencyManifestHashes: [
      ...uniqueSortedManifestHashes(input.previousProjection.path),
      ...uniqueSortedManifestHashes(input.destinationParentProjection.path),
    ],
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
  const { containerKey, destinationParentKey } = await unwrapMoveContainerKeys({
    destinationParentKek: destinationParent.kek,
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    sourceKek: source.kek,
    targetSecretKey: input.targetSecretKey,
  });
  const keyEpoch = buildContainerCreateKeyEpoch({
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
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerMovePlan;
  response: ContainerMutationResponse;
} | null> {
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

export async function buildContainerCreatePlan({
  author,
  containerId = crypto.randomUUID(),
  containerKey,
  containerKeyEpochId = crypto.randomUUID(),
  eventId = crypto.randomUUID(),
  metadataDocumentId = crypto.randomUUID(),
  parentKekMaterial,
  parentProjection,
  signedAt = new Date().toISOString(),
}: BuildContainerCreatePlanInput): Promise<ContainerCreatePlan> {
  assertContainerCreatePlanInput({
    author,
    containerKey,
    parentKekMaterial,
    parentProjection,
  });
  const parent = getParentCreateContext(parentProjection);
  const body = buildContainerCreateBody({
    containerKeyEpochId,
    metadataDocumentId,
    parentContainerId: parentProjection.containerId,
    parentManifestHash: parent.manifest.manifestHash,
  });
  const { event, eventHash } = await signContainerCreateEvent({
    author,
    body,
    containerId,
    eventId,
    parentPath: parentProjection.path,
    signedAt,
  });
  const { manifest, manifestHash, state } = await deriveContainerCreateManifest(
    {
      author,
      containerId,
      containerKeyEpochId,
      eventHash,
      metadataDocumentId,
      parentContainerId: parentProjection.containerId,
      parentManifestHash: parent.manifest.manifestHash,
    },
  );
  const keyEpoch = buildContainerCreateKeyEpoch({
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
    request: buildContainerCreateRequest({
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

export async function buildMaterializedContainerCreatePlan(input: {
  author: ContainerMutationAuthor;
  containerId?: string | undefined;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  metadataDocumentId?: string | undefined;
  parentProjection: ContainerWriterProjectionResponse;
  parentSecretKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<MaterializedContainerCreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));

  const parent = getParentCreateContext(input.parentProjection);
  const parentKeksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.parentProjection,
    secretKey: input.parentSecretKey,
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
  execSql?: ExecSql | undefined;
  metadataDocumentId?: string | undefined;
  parentContainerId: string;
  parentSecretKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<CreateRemoteContainerResult | null> {
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
