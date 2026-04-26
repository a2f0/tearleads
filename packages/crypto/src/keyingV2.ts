import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { toFingerprint } from "./fingerprint";
import type {
  PrincipalProjectionMember,
  PrincipalStatePayloadCipherSuite,
  SignedPrincipalState,
} from "./principalState";
import {
  computePrincipalProjectionRoot,
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  normalizePrincipalProjectionMembers,
  verifySignedPrincipalState,
} from "./principalState";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

/**
 * Keying V2 verifier contracts are the executable security boundary.
 *
 * API responses are untrusted JSON until they pass these pure verifiers. Route
 * code and app code should derive encryption targets only from branded verified
 * values, never directly from server-authored projection rows.
 */

const TEXT_ENCODER = new TextEncoder();

type CanonicalJsonPrimitive = boolean | number | string | null;

export type KeyingV2CanonicalJson =
  | CanonicalJsonPrimitive
  | readonly KeyingV2CanonicalJson[]
  | { readonly [key: string]: KeyingV2CanonicalJson };

export type KeyingV2HashDomain =
  | "tearleads.keying-v2.access-event-body.v1"
  | "tearleads.keying-v2.access-event-signing.v1"
  | "tearleads.keying-v2.access-event.v1"
  | "tearleads.keying-v2.access-manifest.v1"
  | "tearleads.keying-v2.blob-content-key-targets.v1"
  | "tearleads.keying-v2.container-kek-recipient-targets.v1"
  | "tearleads.keying-v2.document-content-key-targets.v1"
  | "tearleads.keying-v2.write-header-signing.v1"
  | "tearleads.keying-v2.write-header.v1";

export type AccessEventTypeV2 =
  | "attachment.bind"
  | "attachment.detach"
  | "container.create"
  | "container.grant"
  | "container.move"
  | "container.rekey"
  | "container.revoke"
  | "document.link"
  | "document.unlink";

export type AccessObjectKindV2 = "blob" | "container" | "document";
export type ManagedPrincipalKindV2 = "group" | "organization";
export type KekRecipientKindV2 =
  | "container"
  | "group"
  | "organization"
  | "user";
export type ContentObjectKindV2 = "blob" | "document";

export interface UnsignedAccessEventV2 {
  version: 2;
  eventId: string;
  eventType: AccessEventTypeV2;
  objectKind: AccessObjectKindV2;
  objectId: string;
  organizationId: string;
  previousManifestHash: string | null;
  dependencyManifestHashes: string[];
  bodyHash: string;
  signerUserId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signedAt: string;
}

export interface AccessEventV2 extends UnsignedAccessEventV2 {
  signature: string;
}

export interface ReferencedPrincipalHeadV2 {
  principalType: ManagedPrincipalKindV2;
  principalId: string;
  version: number;
  keyEpoch: number;
  stateHash: string;
  keyFingerprint: string;
}

export interface AccessManifestV2 {
  version: 2;
  objectKind: AccessObjectKindV2;
  objectId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
  structuralHash: string;
  grantRoot: string;
  referencedPrincipalHeads: ReferencedPrincipalHeadV2[];
  keyTargetHash: string;
}

export interface ContainerKekRecipientTargetV2 {
  recipientKind: KekRecipientKindV2;
  recipientId: string;
  recipientKeyEpochId: string;
  recipientKeyFingerprint: string;
}

export interface ContainerKekTargetV2 {
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
}

export type DocumentContentKeyTargetV2 = ContainerKekTargetV2;

export interface BlobContentKeyTargetV2 extends ContainerKekTargetV2 {
  bindingId: string;
  documentId: string;
}

export interface UnsignedWriteHeaderV2 {
  version: 2;
  objectKind: ContentObjectKindV2;
  objectId: string;
  accessManifestHash: string;
  contentKeyEpoch: number;
  targetHash: string;
  metadataHash: string;
  ciphertextHash: string;
  writerUserId: string;
  writerDeviceId: string;
  writerKeyFingerprint: string;
  signedAt: string;
}

export interface WriteHeaderV2 extends UnsignedWriteHeaderV2 {
  signature: string;
}

export type KeyingV2VerificationCode =
  | "duplicate_entry"
  | "equivocation"
  | "hash_mismatch"
  | "invalid_domain"
  | "invalid_shape"
  | "key_epoch_reuse"
  | "missing_dependency"
  | "object_mismatch"
  | "rollback"
  | "signature_mismatch"
  | "signer_mismatch"
  | "stale_predecessor"
  | "unauthorized";

export class KeyingV2VerificationError extends Error {
  constructor(
    readonly code: KeyingV2VerificationCode,
    message: string,
  ) {
    super(message);
    this.name = "KeyingV2VerificationError";
  }
}

export type KeyingV2VerificationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KeyingV2VerificationError };

declare const verifiedIdentityStateBrand: unique symbol;
declare const verifiedPrincipalPolicyBrand: unique symbol;
declare const verifiedAccessEventBrand: unique symbol;
declare const verifiedAccessManifestBrand: unique symbol;
declare const verifiedContainerKekStateBrand: unique symbol;
declare const verifiedWriteHeaderBrand: unique symbol;

export interface VerifiedIdentityState {
  readonly stateHash: string;
  readonly [verifiedIdentityStateBrand]: true;
}

export interface VerifiedPrincipalPolicy {
  readonly principalType: ManagedPrincipalKindV2;
  readonly principalId: string;
  readonly version: number;
  readonly keyEpoch: number;
  readonly stateHash: string;
  readonly state: PrincipalPolicySignedStateV2;
  readonly projection: PrincipalProjectionMember[];
  readonly checkpoint: PrincipalPolicyCheckpointV2;
  readonly [verifiedPrincipalPolicyBrand]: true;
}

export interface VerifiedAccessEvent {
  readonly event: AccessEventV2;
  readonly body: KeyingV2CanonicalJson;
  readonly eventHash: string;
  readonly [verifiedAccessEventBrand]: true;
}

export interface VerifiedAccessManifest {
  readonly manifest: AccessManifestV2;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly [verifiedAccessManifestBrand]: true;
}

export interface VerifiedContainerKekState {
  readonly containerId: string;
  readonly accessManifestHash: string;
  readonly keyTargetHash: string;
  readonly [verifiedContainerKekStateBrand]: true;
}

export interface VerifiedWriteHeader {
  readonly header: WriteHeaderV2;
  readonly headerHash: string;
  readonly [verifiedWriteHeaderBrand]: true;
}

interface ExpectedObjectV2 {
  readonly objectKind: AccessObjectKindV2;
  readonly objectId: string;
}

interface ExpectedWriteObjectV2 {
  readonly objectKind: ContentObjectKindV2;
  readonly objectId: string;
}

export interface VerifyAccessEventInput {
  readonly event: AccessEventV2;
  readonly body: KeyingV2CanonicalJson;
  readonly signerPublicKey: Uint8Array;
}

export interface VerifyAccessManifestInput {
  readonly manifest: AccessManifestV2;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly expectedObject?: ExpectedObjectV2;
  readonly expectedPreviousManifestHash?: string | null;
}

export interface VerifyWriteHeaderInput {
  readonly header: WriteHeaderV2;
  readonly writerPublicKey: Uint8Array;
  readonly expectedObject?: ExpectedWriteObjectV2;
  readonly expectedAccessManifestHash?: string;
  readonly expectedTargetHash?: string;
}

export interface PrincipalPolicyCheckpointV2 {
  readonly principalType: ManagedPrincipalKindV2;
  readonly principalId: string;
  readonly version: number;
  readonly stateHash: string;
}

export interface IdentityStateCheckpointV2 {
  readonly identityId: string;
  readonly version: number;
  readonly stateHash: string;
}

export interface KeyingV2LocalCheckpointStore {
  readonly readIdentityStateCheckpoint: (
    identityId: string,
  ) => Promise<IdentityStateCheckpointV2 | null>;
  readonly writeIdentityStateCheckpoint: (
    checkpoint: IdentityStateCheckpointV2,
  ) => Promise<void>;
  readonly readPrincipalPolicyCheckpoint: (
    principalType: ManagedPrincipalKindV2,
    principalId: string,
  ) => Promise<PrincipalPolicyCheckpointV2 | null>;
  readonly writePrincipalPolicyCheckpoint: (
    checkpoint: PrincipalPolicyCheckpointV2,
  ) => Promise<void>;
}

export interface PrincipalPolicySignedStateV2 extends SignedPrincipalState {
  readonly stateHash: string;
}

export interface PrincipalPolicyStateChainEntryV2 {
  readonly state: PrincipalPolicySignedStateV2;
  readonly projection: readonly PrincipalProjectionMember[];
}

export interface PrincipalPolicyPayloadV2 {
  readonly principalType: ManagedPrincipalKindV2;
  readonly principalId: string;
  readonly stateHash: string;
  readonly cipherSuite: PrincipalStatePayloadCipherSuite;
  readonly ciphertext: string;
  readonly ciphertextHash: string;
}

export interface PrincipalPolicyMemberEnvelopesV2 {
  readonly principalType: ManagedPrincipalKindV2;
  readonly principalId: string;
  readonly stateHash: string;
  readonly epoch: number;
}

export interface PrincipalPolicyBundleV2 {
  readonly currentState: PrincipalPolicySignedStateV2;
  readonly currentPayload: PrincipalPolicyPayloadV2;
  readonly currentProjection: readonly PrincipalProjectionMember[];
  readonly currentMemberEnvelopes?: PrincipalPolicyMemberEnvelopesV2;
  readonly previousStates: readonly PrincipalPolicyStateChainEntryV2[];
}

export interface PrincipalPolicySignerPublicKeyV2 {
  readonly userId: string;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

export interface VerifyPrincipalPolicyBundleInput {
  readonly bundle: PrincipalPolicyBundleV2;
  readonly expectedReference?: ReferencedPrincipalHeadV2;
  readonly localCheckpoint?: PrincipalPolicyCheckpointV2 | null;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKeyV2[];
}

interface NormalizedPrincipalPolicyStateChainEntryV2 {
  readonly state: PrincipalPolicySignedStateV2;
  readonly projection: PrincipalProjectionMember[];
}

function ok<T>(value: T): KeyingV2VerificationResult<T> {
  return { ok: true, value };
}

function fail<T>(
  code: KeyingV2VerificationCode,
  message: string,
): KeyingV2VerificationResult<T> {
  return {
    ok: false,
    error: new KeyingV2VerificationError(code, message),
  };
}

function throwVerification(
  code: KeyingV2VerificationCode,
  message: string,
): never {
  throw new KeyingV2VerificationError(code, message);
}

function toVerificationResult<T>(
  error: unknown,
): KeyingV2VerificationResult<T> {
  if (error instanceof KeyingV2VerificationError) {
    return { ok: false, error };
  }

  return fail(
    "invalid_shape",
    error instanceof Error ? error.message : String(error),
  );
}

async function runVerifier<T>(
  operation: () => Promise<T>,
): Promise<KeyingV2VerificationResult<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    return toVerificationResult(error);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactKeys<const ExpectedKeys extends readonly string[]>(
  value: unknown,
  expectedKeys: ExpectedKeys,
  label: string,
): Record<ExpectedKeys[number], unknown> {
  if (!isPlainObject(value)) {
    throwVerification("invalid_shape", `${label} must be a plain object`);
  }

  const actualKeys = [
    ...Object.getOwnPropertyNames(value),
    ...Object.getOwnPropertySymbols(value).map(String),
  ].sort(compareCanonicalStrings);
  const sortedExpectedKeys = [...expectedKeys].sort(compareCanonicalStrings);

  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throwVerification(
      "invalid_shape",
      `${label} has unexpected keys: ${actualKeys.join(",")}`,
    );
  }

  return value;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throwVerification("invalid_shape", `${label}.${key} must be a string`);
  }

  return value;
}

function readHashString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);

  if (!/^[0-9a-f]{64}$/.test(value)) {
    throwVerification(
      "hash_mismatch",
      `${label}.${key} must be a 64-character lowercase hex hash`,
    );
  }

  return value;
}

function readNullableHashString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throwVerification(
      "hash_mismatch",
      `${label}.${key} must be null or a 64-character lowercase hex hash`,
    );
  }

  return value;
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];

  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be a positive integer`,
    );
  }

  return value;
}

function readVersion(record: { readonly version: unknown }, label: string): 2 {
  const value = record.version;

  if (value !== 2) {
    throwVerification("invalid_domain", `${label}.version must be 2`);
  }

  return 2;
}

function readSignedAt(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);

  if (Number.isNaN(new Date(value).valueOf())) {
    throwVerification("invalid_shape", `${label}.${key} must be a timestamp`);
  }

  return value;
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const value = record[key];

  if (!Array.isArray(value)) {
    throwVerification("invalid_shape", `${label}.${key} must be an array`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      throwVerification(
        "invalid_shape",
        `${label}.${key}[${index}] must be a string`,
      );
    }

    return item;
  });
}

function normalizeUniqueSortedStrings(
  values: readonly string[],
  label: string,
): string[] {
  const sortedValues = [...values].sort(compareCanonicalStrings);

  for (let index = 1; index < sortedValues.length; index += 1) {
    if (sortedValues[index - 1] === sortedValues[index]) {
      throwVerification("duplicate_entry", `${label} contains a duplicate`);
    }
  }

  return sortedValues;
}

function normalizeCanonicalJsonValue(
  value: KeyingV2CanonicalJson,
  label: string,
): KeyingV2CanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throwVerification(
        "invalid_shape",
        `${label} contains a non-finite number`,
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeCanonicalJsonValue(item, `${label}[${index}]`),
    );
  }

  if (!isPlainObject(value)) {
    throwVerification("invalid_shape", `${label} must be canonical JSON`);
  }

  const normalized: Record<string, KeyingV2CanonicalJson> = {};

  for (const key of Object.keys(value).sort(compareCanonicalStrings)) {
    const item = value[key];
    if (item === undefined) {
      throwVerification("invalid_shape", `${label}.${key} is undefined`);
    }
    normalized[key] = normalizeCanonicalJsonValue(item, `${label}.${key}`);
  }

  return normalized;
}

function stringifyCanonicalJson(value: KeyingV2CanonicalJson): string {
  const normalizedValue = normalizeCanonicalJsonValue(value, "payload");

  if (normalizedValue === null) {
    return "null";
  }

  if (typeof normalizedValue === "string") {
    return JSON.stringify(normalizedValue);
  }

  if (typeof normalizedValue === "number") {
    return JSON.stringify(normalizedValue);
  }

  if (typeof normalizedValue === "boolean") {
    return normalizedValue ? "true" : "false";
  }

  if (Array.isArray(normalizedValue)) {
    return `[${normalizedValue.map((item) => stringifyCanonicalJson(item)).join(",")}]`;
  }

  const normalizedObject = normalizedValue as {
    readonly [key: string]: KeyingV2CanonicalJson;
  };

  return `{${Object.keys(normalizedObject)
    .sort(compareCanonicalStrings)
    .map((key) => {
      const item = normalizedObject[key];
      if (item === undefined) {
        throwVerification("invalid_shape", `payload.${key} is undefined`);
      }
      return `${JSON.stringify(key)}:${stringifyCanonicalJson(item)}`;
    })
    .join(",")}}`;
}

function encodeDomainPayload(
  domain: KeyingV2HashDomain,
  payload: KeyingV2CanonicalJson,
): Uint8Array {
  return TEXT_ENCODER.encode(
    stringifyCanonicalJson({
      domain,
      payload,
    }),
  );
}

export function serializeKeyingV2CanonicalJson(
  value: KeyingV2CanonicalJson,
): string {
  return stringifyCanonicalJson(value);
}

export async function computeKeyingV2DomainHash(
  domain: KeyingV2HashDomain,
  payload: KeyingV2CanonicalJson,
): Promise<string> {
  return toFingerprint(encodeDomainPayload(domain, payload));
}

function isAccessEventType(value: string): value is AccessEventTypeV2 {
  return (
    value === "attachment.bind" ||
    value === "attachment.detach" ||
    value === "container.create" ||
    value === "container.grant" ||
    value === "container.move" ||
    value === "container.rekey" ||
    value === "container.revoke" ||
    value === "document.link" ||
    value === "document.unlink"
  );
}

function isAccessObjectKind(value: string): value is AccessObjectKindV2 {
  return value === "blob" || value === "container" || value === "document";
}

function isManagedPrincipalKind(
  value: string,
): value is ManagedPrincipalKindV2 {
  return value === "group" || value === "organization";
}

function isKekRecipientKind(value: string): value is KekRecipientKindV2 {
  return (
    value === "container" ||
    value === "group" ||
    value === "organization" ||
    value === "user"
  );
}

function isContentObjectKind(value: string): value is ContentObjectKindV2 {
  return value === "blob" || value === "document";
}

function expectedObjectKindForEventType(
  eventType: AccessEventTypeV2,
): AccessObjectKindV2 {
  if (eventType.startsWith("container.")) {
    return "container";
  }

  if (eventType.startsWith("document.")) {
    return "document";
  }

  return "blob";
}

function normalizeAccessEventType(
  value: unknown,
  label: string,
): AccessEventTypeV2 {
  if (typeof value !== "string" || !isAccessEventType(value)) {
    throwVerification("invalid_domain", `${label}.eventType is unsupported`);
  }

  return value;
}

function normalizeAccessObjectKind(
  value: unknown,
  label: string,
): AccessObjectKindV2 {
  if (typeof value !== "string" || !isAccessObjectKind(value)) {
    throwVerification("invalid_domain", `${label}.objectKind is unsupported`);
  }

  return value;
}

function normalizeManagedPrincipalKind(
  value: unknown,
  label: string,
): ManagedPrincipalKindV2 {
  if (typeof value !== "string" || !isManagedPrincipalKind(value)) {
    throwVerification(
      "invalid_domain",
      `${label}.principalType is unsupported`,
    );
  }

  return value;
}

function normalizeKekRecipientKind(
  value: unknown,
  label: string,
): KekRecipientKindV2 {
  if (typeof value !== "string" || !isKekRecipientKind(value)) {
    throwVerification(
      "invalid_domain",
      `${label}.recipientKind is unsupported`,
    );
  }

  return value;
}

function normalizeContentObjectKind(
  value: unknown,
  label: string,
): ContentObjectKindV2 {
  if (typeof value !== "string" || !isContentObjectKind(value)) {
    throwVerification("invalid_domain", `${label}.objectKind is unsupported`);
  }

  return value;
}

function principalProjectionMemberKey(
  member: PrincipalProjectionMember,
): string {
  return `${member.memberPrincipalType}:${member.memberPrincipalId}`;
}

function principalProjectionRoleRank(
  role: PrincipalProjectionMember["role"],
): number {
  return role === "admin" ? 2 : 1;
}

function projectionIncludesAdminUser(
  projection: readonly PrincipalProjectionMember[],
  userId: string,
): boolean {
  return projection.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === userId &&
      member.role === "admin",
  );
}

function hasPrincipalPolicyProjectionShrink(input: {
  currentProjection: readonly PrincipalProjectionMember[];
  previousProjection: readonly PrincipalProjectionMember[];
}): boolean {
  const currentProjectionByMember = new Map<string, PrincipalProjectionMember>(
    input.currentProjection.map((member) => [
      principalProjectionMemberKey(member),
      member,
    ]),
  );

  return input.previousProjection.some((previousMember) => {
    const currentMember = currentProjectionByMember.get(
      principalProjectionMemberKey(previousMember),
    );

    if (!currentMember) {
      return true;
    }

    return (
      principalProjectionRoleRank(currentMember.role) <
      principalProjectionRoleRank(previousMember.role)
    );
  });
}

function principalPolicyKeyMaterialChanged(input: {
  currentState: SignedPrincipalState;
  previousState: SignedPrincipalState;
}): boolean {
  return (
    input.currentState.encapsulationPublicKey !==
      input.previousState.encapsulationPublicKey ||
    input.currentState.keyFingerprint !== input.previousState.keyFingerprint
  );
}

export function getPrincipalPolicyTransitionMismatchReason(input: {
  readonly current: {
    readonly projection: readonly PrincipalProjectionMember[];
    readonly state: SignedPrincipalState;
  };
  readonly previous: {
    readonly projection: readonly PrincipalProjectionMember[];
    readonly state: PrincipalPolicySignedStateV2;
  };
}): string | null {
  const { current, previous } = input;

  if (
    current.state.principalType !== previous.state.principalType ||
    current.state.principalId !== previous.state.principalId
  ) {
    return "Principal policy transition principal mismatch";
  }

  if (current.state.version !== previous.state.version + 1) {
    return "Principal policy transition version is not contiguous";
  }

  if (current.state.prevStateHash !== previous.state.stateHash) {
    return "Principal policy transition previous hash mismatch";
  }

  if (current.state.keyEpoch < previous.state.keyEpoch) {
    return "Principal policy key epoch cannot decrease";
  }

  const previousProjection = normalizePrincipalProjectionMembers(
    previous.projection,
  );
  const currentProjection = normalizePrincipalProjectionMembers(
    current.projection,
  );
  const keyMaterialChanged = principalPolicyKeyMaterialChanged({
    currentState: current.state,
    previousState: previous.state,
  });

  if (
    current.state.keyEpoch === previous.state.keyEpoch &&
    keyMaterialChanged
  ) {
    return "Principal policy key change requires a new key epoch";
  }

  if (current.state.keyEpoch > previous.state.keyEpoch && !keyMaterialChanged) {
    return "Principal policy key epoch advance requires new key material";
  }

  if (
    hasPrincipalPolicyProjectionShrink({
      currentProjection,
      previousProjection,
    }) &&
    (current.state.keyEpoch <= previous.state.keyEpoch || !keyMaterialChanged)
  ) {
    return "Principal policy shrink requires a new key epoch and key material";
  }

  return null;
}

function mapPrincipalPolicyTransitionError(message: string): void {
  if (
    message.includes("key epoch") ||
    message.includes("key change") ||
    message.includes("shrink")
  ) {
    throwVerification("key_epoch_reuse", message);
  }

  if (message.includes("previous hash")) {
    throwVerification("stale_predecessor", message);
  }

  throwVerification("invalid_shape", message);
}

function normalizePrincipalPolicySignerKey(
  signerKey: PrincipalPolicySignerPublicKeyV2,
): PrincipalPolicySignerPublicKeyV2 {
  if (signerKey.userId.length === 0) {
    throwVerification("invalid_shape", "principal policy signer user missing");
  }

  if (!/^[0-9a-f]{64}$/.test(signerKey.signingKeyFingerprint)) {
    throwVerification(
      "hash_mismatch",
      "principal policy signer fingerprint must be a 64-character lowercase hex hash",
    );
  }

  if (signerKey.signingPublicKey.length === 0) {
    throwVerification(
      "invalid_shape",
      "principal policy signer public key missing",
    );
  }

  return signerKey;
}

async function buildPrincipalPolicySignerKeyMap(
  signerPublicKeys: readonly PrincipalPolicySignerPublicKeyV2[],
): Promise<Map<string, Uint8Array>> {
  const signerPublicKeyByUserAndFingerprint = new Map<string, Uint8Array>();

  for (const signerKey of signerPublicKeys.map(
    normalizePrincipalPolicySignerKey,
  )) {
    const computedFingerprint = await toFingerprint(signerKey.signingPublicKey);

    if (computedFingerprint !== signerKey.signingKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "principal policy signer key fingerprint does not match public key",
      );
    }

    const key = `${signerKey.userId}:${signerKey.signingKeyFingerprint}`;
    if (signerPublicKeyByUserAndFingerprint.has(key)) {
      throwVerification(
        "duplicate_entry",
        "principal policy signer key list contains a duplicate",
      );
    }

    signerPublicKeyByUserAndFingerprint.set(key, signerKey.signingPublicKey);
  }

  return signerPublicKeyByUserAndFingerprint;
}

function getPrincipalPolicySignerPublicKey(input: {
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
  readonly state: SignedPrincipalState;
}): Uint8Array {
  const signerPublicKey = input.signerPublicKeyByUserAndFingerprint.get(
    `${input.state.signerUserId}:${input.state.signerUserKeyFingerprint}`,
  );

  if (!signerPublicKey) {
    throwVerification(
      "missing_dependency",
      "principal policy signer public key is unavailable",
    );
  }

  return signerPublicKey;
}

async function normalizePrincipalPolicyStateChainEntry(
  entry: PrincipalPolicyStateChainEntryV2,
): Promise<NormalizedPrincipalPolicyStateChainEntryV2> {
  const projection = normalizePrincipalProjectionMembers(entry.projection);
  const computedStateHash = await computePrincipalStateHash(entry.state);

  if (computedStateHash !== entry.state.stateHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy state hash does not match signed state",
    );
  }

  const computedProjectionRoot =
    await computePrincipalProjectionRoot(projection);

  if (computedProjectionRoot !== entry.state.projectionRoot) {
    throwVerification(
      "hash_mismatch",
      "principal policy projection root does not match projection",
    );
  }

  if (projection.length !== entry.state.memberCount) {
    throwVerification(
      "invalid_shape",
      "principal policy projection count does not match state member count",
    );
  }

  return {
    state: entry.state,
    projection,
  };
}

function verifyPrincipalPolicyReference(input: {
  readonly expectedReference: ReferencedPrincipalHeadV2 | undefined;
  readonly state: PrincipalPolicySignedStateV2;
}): void {
  const { expectedReference, state } = input;

  if (!expectedReference) {
    return;
  }

  if (
    expectedReference.principalType !== state.principalType ||
    expectedReference.principalId !== state.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy bundle does not match referenced principal",
    );
  }

  if (
    expectedReference.version !== state.version ||
    expectedReference.keyEpoch !== state.keyEpoch ||
    expectedReference.stateHash !== state.stateHash ||
    expectedReference.keyFingerprint !== state.keyFingerprint
  ) {
    throwVerification(
      "hash_mismatch",
      "principal policy bundle does not match referenced principal head",
    );
  }
}

async function verifyPrincipalPolicyPayload(input: {
  readonly bundle: PrincipalPolicyBundleV2;
}): Promise<void> {
  const { currentPayload, currentState } = input.bundle;

  if (
    currentPayload.principalType !== currentState.principalType ||
    currentPayload.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy payload does not match current state principal",
    );
  }

  if (currentPayload.stateHash !== currentState.stateHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload state hash does not match current state",
    );
  }

  const computedPayloadHash = await computePrincipalStatePayloadCiphertextHash(
    currentPayload.ciphertext,
  );

  if (computedPayloadHash !== currentPayload.ciphertextHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload hash does not match ciphertext",
    );
  }

  if (computedPayloadHash !== currentState.payloadCiphertextHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload hash does not match current state",
    );
  }
}

function verifyPrincipalPolicyMemberEnvelopes(input: {
  readonly bundle: PrincipalPolicyBundleV2;
}): void {
  const { currentMemberEnvelopes, currentState } = input.bundle;

  if (!currentMemberEnvelopes) {
    return;
  }

  if (
    currentMemberEnvelopes.principalType !== currentState.principalType ||
    currentMemberEnvelopes.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy member envelopes do not match current state principal",
    );
  }

  if (
    currentMemberEnvelopes.stateHash !== currentState.stateHash ||
    currentMemberEnvelopes.epoch !== currentState.keyEpoch
  ) {
    throwVerification(
      "hash_mismatch",
      "principal policy member envelopes do not match current state",
    );
  }
}

function verifyPrincipalPolicyCheckpoint(input: {
  readonly chain: readonly NormalizedPrincipalPolicyStateChainEntryV2[];
  readonly currentState: PrincipalPolicySignedStateV2;
  readonly localCheckpoint: PrincipalPolicyCheckpointV2 | null | undefined;
}): void {
  const { currentState, localCheckpoint } = input;

  if (!localCheckpoint) {
    return;
  }

  if (
    localCheckpoint.principalType !== currentState.principalType ||
    localCheckpoint.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy checkpoint does not match current principal",
    );
  }

  if (currentState.version < localCheckpoint.version) {
    throwVerification(
      "rollback",
      "principal policy state is older than the local checkpoint",
    );
  }

  if (
    currentState.version === localCheckpoint.version &&
    currentState.stateHash !== localCheckpoint.stateHash
  ) {
    throwVerification(
      "equivocation",
      "principal policy state conflicts with the local checkpoint",
    );
  }

  if (currentState.version <= localCheckpoint.version) {
    return;
  }

  const checkpointEntry = input.chain[localCheckpoint.version - 1];
  if (
    !checkpointEntry ||
    checkpointEntry.state.stateHash !== localCheckpoint.stateHash
  ) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain does not extend the local checkpoint",
    );
  }
}

function verifyPrincipalPolicyChainShape(input: {
  readonly chainLength: number;
  readonly currentState: PrincipalPolicySignedStateV2;
}): void {
  if (input.chainLength !== input.currentState.version) {
    throwVerification(
      "missing_dependency",
      "principal policy chain length does not match current state version",
    );
  }
}

function verifyPrincipalPolicyChainEntryIdentity(input: {
  readonly currentState: PrincipalPolicySignedStateV2;
  readonly expectedVersion: number;
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntryV2;
}): void {
  if (
    input.normalizedEntry.state.principalType !==
      input.currentState.principalType ||
    input.normalizedEntry.state.principalId !== input.currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy chain entry principal does not match current state",
    );
  }

  if (input.normalizedEntry.state.version !== input.expectedVersion) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain entry version is not contiguous",
    );
  }
}

function verifyInitialPrincipalPolicyChainEntry(
  normalizedEntry: NormalizedPrincipalPolicyStateChainEntryV2,
): void {
  if (normalizedEntry.state.prevStateHash !== null) {
    throwVerification(
      "stale_predecessor",
      "initial principal policy chain entry has a previous state hash",
    );
  }

  if (
    !projectionIncludesAdminUser(
      normalizedEntry.projection,
      normalizedEntry.state.signerUserId,
    )
  ) {
    throwVerification(
      "unauthorized",
      "initial principal policy state signer is not an admin",
    );
  }
}

function verifySuccessorPrincipalPolicyChainEntry(input: {
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntryV2;
  readonly previousEntry: NormalizedPrincipalPolicyStateChainEntryV2;
}): void {
  if (
    input.normalizedEntry.state.prevStateHash !==
    input.previousEntry.state.stateHash
  ) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain entry previous hash mismatch",
    );
  }

  if (
    !projectionIncludesAdminUser(
      input.previousEntry.projection,
      input.normalizedEntry.state.signerUserId,
    )
  ) {
    throwVerification(
      "unauthorized",
      "principal policy state signer is not an admin in previous projection",
    );
  }

  const transitionMismatch = getPrincipalPolicyTransitionMismatchReason({
    current: input.normalizedEntry,
    previous: input.previousEntry,
  });

  if (transitionMismatch) {
    mapPrincipalPolicyTransitionError(transitionMismatch);
  }
}

async function verifyPrincipalPolicyChainEntrySignature(input: {
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntryV2;
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
}): Promise<void> {
  const signerPublicKey = getPrincipalPolicySignerPublicKey({
    signerPublicKeyByUserAndFingerprint:
      input.signerPublicKeyByUserAndFingerprint,
    state: input.normalizedEntry.state,
  });

  if (
    !(await verifySignedPrincipalState(
      input.normalizedEntry.state,
      signerPublicKey,
    ))
  ) {
    throwVerification(
      "signature_mismatch",
      "principal policy state signature verification failed",
    );
  }
}

async function verifyPrincipalPolicyChain(input: {
  readonly bundle: PrincipalPolicyBundleV2;
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
}): Promise<NormalizedPrincipalPolicyStateChainEntryV2[]> {
  const chain = [
    ...input.bundle.previousStates,
    {
      state: input.bundle.currentState,
      projection: input.bundle.currentProjection,
    },
  ];

  verifyPrincipalPolicyChainShape({
    chainLength: chain.length,
    currentState: input.bundle.currentState,
  });

  const normalizedChain: NormalizedPrincipalPolicyStateChainEntryV2[] = [];

  for (let index = 0; index < chain.length; index += 1) {
    const entry = chain[index];
    if (!entry) {
      throwVerification(
        "missing_dependency",
        "principal policy chain entry is missing",
      );
    }

    const normalizedEntry =
      await normalizePrincipalPolicyStateChainEntry(entry);

    verifyPrincipalPolicyChainEntryIdentity({
      currentState: input.bundle.currentState,
      expectedVersion: index + 1,
      normalizedEntry,
    });

    const previousEntry = normalizedChain[index - 1];
    if (previousEntry) {
      verifySuccessorPrincipalPolicyChainEntry({
        normalizedEntry,
        previousEntry,
      });
    } else {
      verifyInitialPrincipalPolicyChainEntry(normalizedEntry);
    }

    await verifyPrincipalPolicyChainEntrySignature({
      normalizedEntry,
      signerPublicKeyByUserAndFingerprint:
        input.signerPublicKeyByUserAndFingerprint,
    });

    normalizedChain.push(normalizedEntry);
  }

  return normalizedChain;
}

export async function verifyPrincipalPolicyBundle({
  bundle,
  expectedReference,
  localCheckpoint,
  signerPublicKeys,
}: VerifyPrincipalPolicyBundleInput): Promise<
  KeyingV2VerificationResult<VerifiedPrincipalPolicy>
> {
  return runVerifier(async () => {
    const signerPublicKeyByUserAndFingerprint =
      await buildPrincipalPolicySignerKeyMap(signerPublicKeys);
    const normalizedChain = await verifyPrincipalPolicyChain({
      bundle,
      signerPublicKeyByUserAndFingerprint,
    });
    const currentEntry = normalizedChain.at(-1);

    if (!currentEntry) {
      throwVerification(
        "missing_dependency",
        "principal policy chain is empty",
      );
    }

    await verifyPrincipalPolicyPayload({ bundle });
    verifyPrincipalPolicyMemberEnvelopes({ bundle });
    verifyPrincipalPolicyReference({
      expectedReference,
      state: currentEntry.state,
    });
    verifyPrincipalPolicyCheckpoint({
      chain: normalizedChain,
      currentState: currentEntry.state,
      localCheckpoint,
    });

    return {
      principalType: currentEntry.state.principalType,
      principalId: currentEntry.state.principalId,
      version: currentEntry.state.version,
      keyEpoch: currentEntry.state.keyEpoch,
      stateHash: currentEntry.state.stateHash,
      state: currentEntry.state,
      projection: currentEntry.projection,
      checkpoint: {
        principalType: currentEntry.state.principalType,
        principalId: currentEntry.state.principalId,
        version: currentEntry.state.version,
        stateHash: currentEntry.state.stateHash,
      },
    } as VerifiedPrincipalPolicy;
  });
}

function normalizeUnsignedAccessEvent(
  value: UnsignedAccessEventV2,
): UnsignedAccessEventV2 {
  const record = assertExactKeys(
    value,
    [
      "bodyHash",
      "dependencyManifestHashes",
      "eventId",
      "eventType",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "signedAt",
      "signerDeviceId",
      "signerKeyFingerprint",
      "signerUserId",
      "version",
    ],
    "access event",
  );
  const eventType = normalizeAccessEventType(record.eventType, "access event");
  const objectKind = normalizeAccessObjectKind(
    record.objectKind,
    "access event",
  );
  const expectedObjectKind = expectedObjectKindForEventType(eventType);

  if (objectKind !== expectedObjectKind) {
    throwVerification(
      "object_mismatch",
      `access event ${eventType} must use objectKind ${expectedObjectKind}`,
    );
  }

  return {
    version: readVersion(record, "access event"),
    eventId: readString(record, "eventId", "access event"),
    eventType,
    objectKind,
    objectId: readString(record, "objectId", "access event"),
    organizationId: readString(record, "organizationId", "access event"),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "access event",
    ),
    dependencyManifestHashes: normalizeUniqueSortedStrings(
      readStringArray(record, "dependencyManifestHashes", "access event"),
      "access event dependencyManifestHashes",
    ),
    bodyHash: readHashString(record, "bodyHash", "access event"),
    signerUserId: readString(record, "signerUserId", "access event"),
    signerDeviceId: readString(record, "signerDeviceId", "access event"),
    signerKeyFingerprint: readHashString(
      record,
      "signerKeyFingerprint",
      "access event",
    ),
    signedAt: readSignedAt(record, "signedAt", "access event"),
  };
}

function normalizeAccessEvent(value: AccessEventV2): AccessEventV2 {
  const record = assertExactKeys(
    value,
    [
      "bodyHash",
      "dependencyManifestHashes",
      "eventId",
      "eventType",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "signature",
      "signedAt",
      "signerDeviceId",
      "signerKeyFingerprint",
      "signerUserId",
      "version",
    ],
    "access event",
  );
  const unsignedEvent = normalizeUnsignedAccessEvent({
    version: record.version,
    eventId: record.eventId,
    eventType: record.eventType,
    objectKind: record.objectKind,
    objectId: record.objectId,
    organizationId: record.organizationId,
    previousManifestHash: record.previousManifestHash,
    dependencyManifestHashes: record.dependencyManifestHashes,
    bodyHash: record.bodyHash,
    signerUserId: record.signerUserId,
    signerDeviceId: record.signerDeviceId,
    signerKeyFingerprint: record.signerKeyFingerprint,
    signedAt: record.signedAt,
  } as UnsignedAccessEventV2);

  return {
    ...unsignedEvent,
    signature: readString(record, "signature", "access event"),
  };
}

function unsignedAccessEventPayload(
  event: UnsignedAccessEventV2,
): KeyingV2CanonicalJson {
  return normalizeUnsignedAccessEvent(
    event,
  ) as unknown as KeyingV2CanonicalJson;
}

function accessEventSigningBytes(event: UnsignedAccessEventV2): Uint8Array {
  return encodeDomainPayload(
    "tearleads.keying-v2.access-event-signing.v1",
    unsignedAccessEventPayload(event),
  );
}

function toUnsignedAccessEvent(event: AccessEventV2): UnsignedAccessEventV2 {
  return {
    version: event.version,
    eventId: event.eventId,
    eventType: event.eventType,
    objectKind: event.objectKind,
    objectId: event.objectId,
    organizationId: event.organizationId,
    previousManifestHash: event.previousManifestHash,
    dependencyManifestHashes: event.dependencyManifestHashes,
    bodyHash: event.bodyHash,
    signerUserId: event.signerUserId,
    signerDeviceId: event.signerDeviceId,
    signerKeyFingerprint: event.signerKeyFingerprint,
    signedAt: event.signedAt,
  };
}

export async function computeAccessEventBodyHash(
  body: KeyingV2CanonicalJson,
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.access-event-body.v1",
    body,
  );
}

export async function signAccessEvent(
  event: UnsignedAccessEventV2,
  signingPrivateKey: Uint8Array,
): Promise<AccessEventV2> {
  const normalizedEvent = normalizeUnsignedAccessEvent(event);
  const signature = sign(
    accessEventSigningBytes(normalizedEvent),
    signingPrivateKey,
  );

  return {
    ...normalizedEvent,
    signature: bytesToBase64(signature),
  };
}

export async function computeAccessEventHash(
  event: AccessEventV2,
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.access-event.v1",
    normalizeAccessEvent(event) as unknown as KeyingV2CanonicalJson,
  );
}

export async function verifySignedAccessEvent({
  body,
  event,
  signerPublicKey,
}: VerifyAccessEventInput): Promise<
  KeyingV2VerificationResult<VerifiedAccessEvent>
> {
  return runVerifier(async () => {
    const normalizedBody = normalizeCanonicalJsonValue(
      body,
      "access event body",
    );
    const normalizedEvent = normalizeAccessEvent(event);
    const computedBodyHash = await computeAccessEventBodyHash(normalizedBody);

    if (computedBodyHash !== normalizedEvent.bodyHash) {
      throwVerification(
        "hash_mismatch",
        "access event body hash does not match body",
      );
    }

    const signerKeyFingerprint = await toFingerprint(signerPublicKey);
    if (signerKeyFingerprint !== normalizedEvent.signerKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "access event signer fingerprint does not match signer public key",
      );
    }

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedEvent.signature);
    } catch {
      throwVerification("signature_mismatch", "access event signature invalid");
    }

    if (
      !verify(
        signature,
        accessEventSigningBytes(toUnsignedAccessEvent(normalizedEvent)),
        signerPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "access event signature verification failed",
      );
    }

    return {
      event: normalizedEvent,
      body: normalizedBody,
      eventHash: await computeAccessEventHash(normalizedEvent),
    } as VerifiedAccessEvent;
  });
}

function normalizeReferencedPrincipalHead(
  value: ReferencedPrincipalHeadV2,
): ReferencedPrincipalHeadV2 {
  const record = assertExactKeys(
    value,
    [
      "keyEpoch",
      "keyFingerprint",
      "principalId",
      "principalType",
      "stateHash",
      "version",
    ],
    "referenced principal head",
  );

  return {
    principalType: normalizeManagedPrincipalKind(
      record.principalType,
      "referenced principal head",
    ),
    principalId: readString(record, "principalId", "referenced principal head"),
    version: readPositiveInteger(
      record,
      "version",
      "referenced principal head",
    ),
    keyEpoch: readPositiveInteger(
      record,
      "keyEpoch",
      "referenced principal head",
    ),
    stateHash: readHashString(record, "stateHash", "referenced principal head"),
    keyFingerprint: readHashString(
      record,
      "keyFingerprint",
      "referenced principal head",
    ),
  };
}

function referencedPrincipalKey(principal: ReferencedPrincipalHeadV2): string {
  return `${principal.principalType}:${principal.principalId}`;
}

function normalizeReferencedPrincipalHeads(
  values: readonly ReferencedPrincipalHeadV2[],
): ReferencedPrincipalHeadV2[] {
  const normalizedValues = values
    .map(normalizeReferencedPrincipalHead)
    .sort((left, right) =>
      compareCanonicalStrings(
        referencedPrincipalKey(left),
        referencedPrincipalKey(right),
      ),
    );

  for (let index = 1; index < normalizedValues.length; index += 1) {
    if (
      referencedPrincipalKey(
        normalizedValues[index - 1] as ReferencedPrincipalHeadV2,
      ) ===
      referencedPrincipalKey(
        normalizedValues[index] as ReferencedPrincipalHeadV2,
      )
    ) {
      throwVerification(
        "duplicate_entry",
        "access manifest referencedPrincipalHeads contains a duplicate",
      );
    }
  }

  return normalizedValues;
}

function normalizeAccessManifest(value: AccessManifestV2): AccessManifestV2 {
  const record = assertExactKeys(
    value,
    [
      "epoch",
      "eventHash",
      "grantRoot",
      "keyTargetHash",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "referencedPrincipalHeads",
      "structuralHash",
      "version",
    ],
    "access manifest",
  );
  const referencedPrincipalHeads = record.referencedPrincipalHeads;

  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "access manifest.referencedPrincipalHeads must be an array",
    );
  }

  return {
    version: readVersion(record, "access manifest"),
    objectKind: normalizeAccessObjectKind(record.objectKind, "access manifest"),
    objectId: readString(record, "objectId", "access manifest"),
    organizationId: readString(record, "organizationId", "access manifest"),
    epoch: readPositiveInteger(record, "epoch", "access manifest"),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "access manifest",
    ),
    eventHash: readHashString(record, "eventHash", "access manifest"),
    structuralHash: readHashString(record, "structuralHash", "access manifest"),
    grantRoot: readHashString(record, "grantRoot", "access manifest"),
    referencedPrincipalHeads: normalizeReferencedPrincipalHeads(
      referencedPrincipalHeads as ReferencedPrincipalHeadV2[],
    ),
    keyTargetHash: readHashString(record, "keyTargetHash", "access manifest"),
  };
}

export async function computeAccessManifestHash(
  manifest: AccessManifestV2,
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.access-manifest.v1",
    normalizeAccessManifest(manifest) as unknown as KeyingV2CanonicalJson,
  );
}

export async function verifyAccessManifest({
  event,
  expectedManifestHash,
  expectedObject,
  expectedPreviousManifestHash,
  manifest,
}: VerifyAccessManifestInput): Promise<
  KeyingV2VerificationResult<VerifiedAccessManifest>
> {
  return runVerifier(async () => {
    const normalizedManifest = normalizeAccessManifest(manifest);
    const manifestHash = await computeAccessManifestHash(normalizedManifest);

    if (manifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "access manifest hash does not match expected hash",
      );
    }

    if (event.eventHash !== normalizedManifest.eventHash) {
      throwVerification(
        "hash_mismatch",
        "access manifest event hash does not match verified event",
      );
    }

    if (
      event.event.objectKind !== normalizedManifest.objectKind ||
      event.event.objectId !== normalizedManifest.objectId ||
      event.event.organizationId !== normalizedManifest.organizationId
    ) {
      throwVerification(
        "object_mismatch",
        "access manifest object does not match verified event",
      );
    }

    if (
      event.event.previousManifestHash !==
      normalizedManifest.previousManifestHash
    ) {
      throwVerification(
        "stale_predecessor",
        "access manifest predecessor does not match verified event",
      );
    }

    if (
      expectedPreviousManifestHash !== undefined &&
      expectedPreviousManifestHash !== normalizedManifest.previousManifestHash
    ) {
      throwVerification(
        "stale_predecessor",
        "access manifest predecessor does not match expected predecessor",
      );
    }

    if (
      expectedObject &&
      (expectedObject.objectKind !== normalizedManifest.objectKind ||
        expectedObject.objectId !== normalizedManifest.objectId)
    ) {
      throwVerification(
        "object_mismatch",
        "access manifest object does not match expected object",
      );
    }

    return {
      manifest: normalizedManifest,
      manifestHash,
      event,
    } as VerifiedAccessManifest;
  });
}

function normalizeContainerKekRecipientTarget(
  value: ContainerKekRecipientTargetV2,
): ContainerKekRecipientTargetV2 {
  const record = assertExactKeys(
    value,
    [
      "recipientId",
      "recipientKeyEpochId",
      "recipientKeyFingerprint",
      "recipientKind",
    ],
    "container KEK recipient target",
  );

  return {
    recipientKind: normalizeKekRecipientKind(
      record.recipientKind,
      "container KEK recipient target",
    ),
    recipientId: readString(
      record,
      "recipientId",
      "container KEK recipient target",
    ),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container KEK recipient target",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container KEK recipient target",
    ),
  };
}

function containerKekRecipientTargetKey(
  target: ContainerKekRecipientTargetV2,
): string {
  return `${target.recipientKind}:${target.recipientId}:${target.recipientKeyEpochId}`;
}

function normalizeContainerKekTarget(
  value: ContainerKekTargetV2,
  label: string,
): ContainerKekTargetV2 {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpoch",
      "containerKeyEpochId",
      "containerManifestHash",
    ],
    label,
  );

  return {
    containerId: readString(record, "containerId", label),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      label,
    ),
    containerKeyEpochId: readString(record, "containerKeyEpochId", label),
    containerKeyEpoch: readPositiveInteger(record, "containerKeyEpoch", label),
  };
}

function containerKekTargetKey(target: ContainerKekTargetV2): string {
  return `${target.containerId}:${target.containerKeyEpochId}`;
}

function normalizeBlobContentKeyTarget(
  value: BlobContentKeyTargetV2,
): BlobContentKeyTargetV2 {
  const record = assertExactKeys(
    value,
    [
      "bindingId",
      "containerId",
      "containerKeyEpoch",
      "containerKeyEpochId",
      "containerManifestHash",
      "documentId",
    ],
    "blob content-key target",
  );

  return {
    containerId: readString(record, "containerId", "blob content-key target"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "blob content-key target",
    ),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "blob content-key target",
    ),
    containerKeyEpoch: readPositiveInteger(
      record,
      "containerKeyEpoch",
      "blob content-key target",
    ),
    bindingId: readString(record, "bindingId", "blob content-key target"),
    documentId: readString(record, "documentId", "blob content-key target"),
  };
}

function blobContentKeyTargetKey(target: BlobContentKeyTargetV2): string {
  return `${target.bindingId}:${target.documentId}:${containerKekTargetKey(target)}`;
}

function normalizeSortedUniqueArray<T>(
  values: readonly T[],
  normalize: (value: T) => T,
  key: (value: T) => string,
  label: string,
): T[] {
  const normalizedValues = values
    .map(normalize)
    .sort((left, right) => compareCanonicalStrings(key(left), key(right)));

  for (let index = 1; index < normalizedValues.length; index += 1) {
    if (
      key(normalizedValues[index - 1] as T) ===
      key(normalizedValues[index] as T)
    ) {
      throwVerification("duplicate_entry", `${label} contains a duplicate`);
    }
  }

  return normalizedValues;
}

export async function computeContainerKekRecipientTargetHash(
  targets: readonly ContainerKekRecipientTargetV2[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    normalizeContainerKekRecipientTarget,
    containerKekRecipientTargetKey,
    "container KEK recipient targets",
  );

  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.container-kek-recipient-targets.v1",
    normalizedTargets as unknown as KeyingV2CanonicalJson,
  );
}

export async function computeDocumentContentKeyTargetHash(
  targets: readonly DocumentContentKeyTargetV2[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    (target) =>
      normalizeContainerKekTarget(target, "document content-key target"),
    containerKekTargetKey,
    "document content-key targets",
  );

  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.document-content-key-targets.v1",
    normalizedTargets as unknown as KeyingV2CanonicalJson,
  );
}

export async function computeBlobContentKeyTargetHash(
  targets: readonly BlobContentKeyTargetV2[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    normalizeBlobContentKeyTarget,
    blobContentKeyTargetKey,
    "blob content-key targets",
  );

  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.blob-content-key-targets.v1",
    normalizedTargets as unknown as KeyingV2CanonicalJson,
  );
}

function normalizeUnsignedWriteHeader(
  value: UnsignedWriteHeaderV2,
): UnsignedWriteHeaderV2 {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "ciphertextHash",
      "contentKeyEpoch",
      "metadataHash",
      "objectId",
      "objectKind",
      "signedAt",
      "targetHash",
      "version",
      "writerDeviceId",
      "writerKeyFingerprint",
      "writerUserId",
    ],
    "write header",
  );

  return {
    version: readVersion(record, "write header"),
    objectKind: normalizeContentObjectKind(record.objectKind, "write header"),
    objectId: readString(record, "objectId", "write header"),
    accessManifestHash: readHashString(
      record,
      "accessManifestHash",
      "write header",
    ),
    contentKeyEpoch: readPositiveInteger(
      record,
      "contentKeyEpoch",
      "write header",
    ),
    targetHash: readHashString(record, "targetHash", "write header"),
    metadataHash: readHashString(record, "metadataHash", "write header"),
    ciphertextHash: readHashString(record, "ciphertextHash", "write header"),
    writerUserId: readString(record, "writerUserId", "write header"),
    writerDeviceId: readString(record, "writerDeviceId", "write header"),
    writerKeyFingerprint: readHashString(
      record,
      "writerKeyFingerprint",
      "write header",
    ),
    signedAt: readSignedAt(record, "signedAt", "write header"),
  };
}

function normalizeWriteHeader(value: WriteHeaderV2): WriteHeaderV2 {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "ciphertextHash",
      "contentKeyEpoch",
      "metadataHash",
      "objectId",
      "objectKind",
      "signature",
      "signedAt",
      "targetHash",
      "version",
      "writerDeviceId",
      "writerKeyFingerprint",
      "writerUserId",
    ],
    "write header",
  );
  const unsignedHeader = normalizeUnsignedWriteHeader({
    version: record.version,
    objectKind: record.objectKind,
    objectId: record.objectId,
    accessManifestHash: record.accessManifestHash,
    contentKeyEpoch: record.contentKeyEpoch,
    targetHash: record.targetHash,
    metadataHash: record.metadataHash,
    ciphertextHash: record.ciphertextHash,
    writerUserId: record.writerUserId,
    writerDeviceId: record.writerDeviceId,
    writerKeyFingerprint: record.writerKeyFingerprint,
    signedAt: record.signedAt,
  } as UnsignedWriteHeaderV2);

  return {
    ...unsignedHeader,
    signature: readString(record, "signature", "write header"),
  };
}

function unsignedWriteHeaderPayload(
  header: UnsignedWriteHeaderV2,
): KeyingV2CanonicalJson {
  return normalizeUnsignedWriteHeader(
    header,
  ) as unknown as KeyingV2CanonicalJson;
}

function writeHeaderSigningBytes(header: UnsignedWriteHeaderV2): Uint8Array {
  return encodeDomainPayload(
    "tearleads.keying-v2.write-header-signing.v1",
    unsignedWriteHeaderPayload(header),
  );
}

function toUnsignedWriteHeader(header: WriteHeaderV2): UnsignedWriteHeaderV2 {
  return {
    version: header.version,
    objectKind: header.objectKind,
    objectId: header.objectId,
    accessManifestHash: header.accessManifestHash,
    contentKeyEpoch: header.contentKeyEpoch,
    targetHash: header.targetHash,
    metadataHash: header.metadataHash,
    ciphertextHash: header.ciphertextHash,
    writerUserId: header.writerUserId,
    writerDeviceId: header.writerDeviceId,
    writerKeyFingerprint: header.writerKeyFingerprint,
    signedAt: header.signedAt,
  };
}

export async function signWriteHeader(
  header: UnsignedWriteHeaderV2,
  signingPrivateKey: Uint8Array,
): Promise<WriteHeaderV2> {
  const normalizedHeader = normalizeUnsignedWriteHeader(header);
  const signature = sign(
    writeHeaderSigningBytes(normalizedHeader),
    signingPrivateKey,
  );

  return {
    ...normalizedHeader,
    signature: bytesToBase64(signature),
  };
}

export async function computeWriteHeaderHash(
  header: WriteHeaderV2,
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.write-header.v1",
    normalizeWriteHeader(header) as unknown as KeyingV2CanonicalJson,
  );
}

export async function verifyWriteHeader({
  expectedAccessManifestHash,
  expectedObject,
  expectedTargetHash,
  header,
  writerPublicKey,
}: VerifyWriteHeaderInput): Promise<
  KeyingV2VerificationResult<VerifiedWriteHeader>
> {
  return runVerifier(async () => {
    const normalizedHeader = normalizeWriteHeader(header);
    const writerKeyFingerprint = await toFingerprint(writerPublicKey);

    if (writerKeyFingerprint !== normalizedHeader.writerKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "write header writer fingerprint does not match writer public key",
      );
    }

    if (
      expectedAccessManifestHash !== undefined &&
      expectedAccessManifestHash !== normalizedHeader.accessManifestHash
    ) {
      throwVerification(
        "hash_mismatch",
        "write header access manifest hash does not match expected hash",
      );
    }

    if (
      expectedTargetHash !== undefined &&
      expectedTargetHash !== normalizedHeader.targetHash
    ) {
      throwVerification(
        "hash_mismatch",
        "write header target hash does not match expected hash",
      );
    }

    if (
      expectedObject &&
      (expectedObject.objectKind !== normalizedHeader.objectKind ||
        expectedObject.objectId !== normalizedHeader.objectId)
    ) {
      throwVerification(
        "object_mismatch",
        "write header object does not match expected object",
      );
    }

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedHeader.signature);
    } catch {
      throwVerification("signature_mismatch", "write header signature invalid");
    }

    if (
      !verify(
        signature,
        writeHeaderSigningBytes(toUnsignedWriteHeader(normalizedHeader)),
        writerPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "write header signature verification failed",
      );
    }

    return {
      header: normalizedHeader,
      headerHash: await computeWriteHeaderHash(normalizedHeader),
    } as VerifiedWriteHeader;
  });
}
