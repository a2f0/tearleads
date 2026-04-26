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
  | "tearleads.keying-v2.container-access-direct-grants.v1"
  | "tearleads.keying-v2.container-access-key-target.v1"
  | "tearleads.keying-v2.container-access-structural.v1"
  | "tearleads.keying-v2.container-key-epoch.v1"
  | "tearleads.keying-v2.container-kek-recipient-targets.v1"
  | "tearleads.keying-v2.document-content-key-targets.v1"
  | "tearleads.keying-v2.document-link-set-grants.v1"
  | "tearleads.keying-v2.document-link-set-key-target.v1"
  | "tearleads.keying-v2.document-link-set-structural.v1"
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
export type ContainerAccessLevelV2 = "admin" | "read" | "write";
export type ContainerGrantSubjectTypeV2 = "group" | "organization" | "user";

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

export interface ContainerDirectGrantV2 {
  accessLevel: ContainerAccessLevelV2;
  subjectId: string;
  subjectType: ContainerGrantSubjectTypeV2;
}

export interface ContainerAccessStructuralV2 {
  parentContainerId: string | null;
  parentManifestHash: string | null;
}

export interface ContainerAccessKeyStateV2 {
  containerKeyEpochId: string | null;
}

export interface ContainerAccessManifestStateV2
  extends ContainerAccessStructuralV2,
    ContainerAccessKeyStateV2 {
  version: 2;
  containerId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
  directGrants: ContainerDirectGrantV2[];
  referencedPrincipalHeads: ReferencedPrincipalHeadV2[];
}

export interface ContainerCreateAccessEventBodyV2
  extends ContainerAccessStructuralV2,
    ContainerAccessKeyStateV2 {
  eventType: "container.create";
  directGrants: ContainerDirectGrantV2[];
  referencedPrincipalHeads: ReferencedPrincipalHeadV2[];
}

export interface ContainerGrantAccessEventBodyV2
  extends ContainerAccessKeyStateV2 {
  eventType: "container.grant";
  grant: ContainerDirectGrantV2;
  referencedPrincipalHead: ReferencedPrincipalHeadV2 | null;
}

export interface ContainerRevokeAccessEventBodyV2
  extends ContainerAccessKeyStateV2 {
  eventType: "container.revoke";
  subjectId: string;
  subjectType: ContainerGrantSubjectTypeV2;
}

export interface ContainerMoveAccessEventBodyV2
  extends ContainerAccessStructuralV2,
    ContainerAccessKeyStateV2 {
  eventType: "container.move";
}

export type ContainerAccessEventBodyV2 =
  | ContainerCreateAccessEventBodyV2
  | ContainerGrantAccessEventBodyV2
  | ContainerMoveAccessEventBodyV2
  | ContainerRevokeAccessEventBodyV2;

export interface DocumentLinkSetStructuralV2 {
  linkedContainerIds: string[];
}

export interface DocumentLinkSetManifestStateV2
  extends DocumentLinkSetStructuralV2 {
  version: 2;
  documentId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
}

export interface DocumentLinkAccessEventBodyV2 {
  eventType: "document.link";
  containerId: string;
  containerManifestHash: string;
}

export interface DocumentUnlinkAccessEventBodyV2 {
  eventType: "document.unlink";
  containerId: string;
  containerManifestHash: string;
}

export type DocumentAccessEventBodyV2 =
  | DocumentLinkAccessEventBodyV2
  | DocumentUnlinkAccessEventBodyV2;

export interface ContainerKekRecipientTargetV2 {
  recipientKind: KekRecipientKindV2;
  recipientId: string;
  recipientKeyEpochId: string;
  recipientKeyFingerprint: string;
}

export interface ContainerKeyEpochV2 {
  id: string;
  containerId: string;
  keyEpoch: number;
  accessManifestHash: string;
  parentContainerKeyEpochId: string | null;
  createdByEventHash: string;
  createdByManifestHash: string;
}

export interface ContainerKeyWrapV2 {
  containerKeyEpochId: string;
  recipientKind: KekRecipientKindV2;
  recipientId: string;
  recipientKeyEpochId: string;
  recipientKeyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
  wrapManifestHash: string;
}

export interface ContainerUserRecipientKeyV2 {
  userId: string;
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
declare const verifiedContainerAccessManifestBrand: unique symbol;
declare const verifiedDocumentLinkSetManifestBrand: unique symbol;
declare const verifiedDocumentKekTargetsBrand: unique symbol;
declare const verifiedContainerParentEdgeBrand: unique symbol;
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

export interface VerifiedContainerAccessManifest {
  readonly manifest: AccessManifestV2;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly state: ContainerAccessManifestStateV2;
  readonly [verifiedContainerAccessManifestBrand]: true;
}

export interface VerifiedDocumentLinkSetManifest {
  readonly manifest: AccessManifestV2;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly state: DocumentLinkSetManifestStateV2;
  readonly [verifiedDocumentLinkSetManifestBrand]: true;
}

export interface VerifiedDocumentKekTargets {
  readonly documentId: string;
  readonly linkSetManifestHash: string;
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly DocumentContentKeyTargetV2[];
  readonly documentKeyTargetHash: string;
  readonly [verifiedDocumentKekTargetsBrand]: true;
}

export interface VerifiedContainerParentEdge {
  readonly childContainerId: string;
  readonly childManifestHash: string;
  readonly parentContainerId: string;
  readonly parentManifestHash: string;
  readonly [verifiedContainerParentEdgeBrand]: true;
}

export interface VerifiedContainerKekState {
  readonly containerId: string;
  readonly accessManifestHash: string;
  readonly containerKeyEpochId: string;
  readonly containerKeyEpoch: number;
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly keyEpochHash: string;
  readonly parentContainerKeyEpochId: string | null;
  readonly keyTargetHash: string;
  readonly recipientTargets: readonly ContainerKekRecipientTargetV2[];
  readonly wraps: readonly ContainerKeyWrapV2[];
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

export interface VerifyContainerAccessManifestInput {
  readonly manifest: AccessManifestV2;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest?: VerifiedContainerAccessManifest | null;
  readonly previousContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly parentContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly destinationParentContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
}

export interface VerifyContainerParentEdgeInput {
  readonly child: VerifiedContainerAccessManifest;
  readonly parentHistory: readonly VerifiedContainerAccessManifest[];
}

export interface VerifyDocumentLinkSetManifestInput {
  readonly manifest: AccessManifestV2;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest?: VerifiedDocumentLinkSetManifest | null;
  readonly targetContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly authorizingContainerPaths?: readonly VerifiedContainerAccessManifest[][];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
}

export interface DeriveContainerKekRecipientTargetsInput {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly parentKekState?: VerifiedContainerKekState | null;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly userRecipientKeys?: readonly ContainerUserRecipientKeyV2[];
}

export interface VerifyContainerKekStateInput
  extends DeriveContainerKekRecipientTargetsInput {
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly wraps: readonly ContainerKeyWrapV2[];
  readonly containerManifestHistory?: readonly VerifiedContainerAccessManifest[];
}

export interface DeriveDocumentKekTargetsInput {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
  readonly containerKekStates: readonly VerifiedContainerKekState[];
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

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length === 0) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be null or string`,
    );
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

function isContainerAccessLevel(
  value: string,
): value is ContainerAccessLevelV2 {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: string,
): value is ContainerGrantSubjectTypeV2 {
  return value === "group" || value === "organization" || value === "user";
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

function normalizeContainerAccessLevel(
  value: unknown,
  label: string,
): ContainerAccessLevelV2 {
  if (typeof value !== "string" || !isContainerAccessLevel(value)) {
    throwVerification("invalid_domain", `${label}.accessLevel is unsupported`);
  }

  return value;
}

function normalizeContainerGrantSubjectType(
  value: unknown,
  label: string,
): ContainerGrantSubjectTypeV2 {
  if (typeof value !== "string" || !isContainerGrantSubjectType(value)) {
    throwVerification("invalid_domain", `${label}.subjectType is unsupported`);
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

  if (currentState.version === localCheckpoint.version) {
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

function containerAccessLevelRank(accessLevel: ContainerAccessLevelV2): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

function mergeContainerAccessLevel(
  current: ContainerAccessLevelV2 | null,
  incoming: ContainerAccessLevelV2,
): ContainerAccessLevelV2 {
  if (
    current === null ||
    containerAccessLevelRank(incoming) > containerAccessLevelRank(current)
  ) {
    return incoming;
  }

  return current;
}

function normalizeContainerDirectGrant(
  value: ContainerDirectGrantV2,
): ContainerDirectGrantV2 {
  const record = assertExactKeys(
    value,
    ["accessLevel", "subjectId", "subjectType"],
    "container direct grant",
  );

  return {
    accessLevel: normalizeContainerAccessLevel(
      record.accessLevel,
      "container direct grant",
    ),
    subjectId: readString(record, "subjectId", "container direct grant"),
    subjectType: normalizeContainerGrantSubjectType(
      record.subjectType,
      "container direct grant",
    ),
  };
}

function containerDirectGrantKey(grant: ContainerDirectGrantV2): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

function normalizeContainerDirectGrants(
  values: readonly ContainerDirectGrantV2[],
): ContainerDirectGrantV2[] {
  return normalizeSortedUniqueArray(
    values,
    normalizeContainerDirectGrant,
    containerDirectGrantKey,
    "container direct grants",
  );
}

function normalizeContainerAccessStructural(
  value: ContainerAccessStructuralV2,
): ContainerAccessStructuralV2 {
  const record = assertExactKeys(
    value,
    ["parentContainerId", "parentManifestHash"],
    "container access structural state",
  );
  const parentContainerId = readNullableString(
    record,
    "parentContainerId",
    "container access structural state",
  );
  const parentManifestHash = readNullableHashString(
    record,
    "parentManifestHash",
    "container access structural state",
  );

  if ((parentContainerId === null) !== (parentManifestHash === null)) {
    throwVerification(
      "invalid_shape",
      "container access parent id and parent manifest hash must both be present or both be null",
    );
  }

  return {
    parentContainerId,
    parentManifestHash,
  };
}

function normalizeContainerAccessKeyState(
  value: ContainerAccessKeyStateV2,
): ContainerAccessKeyStateV2 {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId"],
    "container access key state",
  );

  return {
    containerKeyEpochId: readNullableString(
      record,
      "containerKeyEpochId",
      "container access key state",
    ),
  };
}

function managedGrantReferenceKey(
  grant: ContainerDirectGrantV2,
): string | null {
  if (grant.subjectType === "user") {
    return null;
  }

  return `${grant.subjectType}:${grant.subjectId}`;
}

function assertReferencedPrincipalHeadsMatchDirectGrants(input: {
  readonly directGrants: readonly ContainerDirectGrantV2[];
  readonly referencedPrincipalHeads: readonly ReferencedPrincipalHeadV2[];
}): void {
  const managedGrantKeys = new Set<string>();
  for (const grant of input.directGrants) {
    const key = managedGrantReferenceKey(grant);
    if (key) {
      managedGrantKeys.add(key);
    }
  }

  const referencedKeys = new Set<string>();
  for (const principalHead of input.referencedPrincipalHeads) {
    referencedKeys.add(referencedPrincipalKey(principalHead));
  }

  for (const grantKey of managedGrantKeys) {
    if (!referencedKeys.has(grantKey)) {
      throwVerification(
        "missing_dependency",
        "container access manifest is missing a referenced principal head",
      );
    }
  }

  for (const referencedKey of referencedKeys) {
    if (!managedGrantKeys.has(referencedKey)) {
      throwVerification(
        "missing_dependency",
        "container access manifest references a principal without a direct grant",
      );
    }
  }
}

function normalizeContainerAccessManifestState(
  value: ContainerAccessManifestStateV2,
): ContainerAccessManifestStateV2 {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpochId",
      "directGrants",
      "epoch",
      "eventHash",
      "organizationId",
      "parentContainerId",
      "parentManifestHash",
      "previousManifestHash",
      "referencedPrincipalHeads",
      "version",
    ],
    "container access manifest state",
  );
  const directGrants = record.directGrants;
  const referencedPrincipalHeads = record.referencedPrincipalHeads;

  if (!Array.isArray(directGrants)) {
    throwVerification(
      "invalid_shape",
      "container access manifest state.directGrants must be an array",
    );
  }

  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "container access manifest state.referencedPrincipalHeads must be an array",
    );
  }

  const structural = normalizeContainerAccessStructural({
    parentContainerId: record.parentContainerId,
    parentManifestHash: record.parentManifestHash,
  } as ContainerAccessStructuralV2);
  const keyState = normalizeContainerAccessKeyState({
    containerKeyEpochId: record.containerKeyEpochId,
  } as ContainerAccessKeyStateV2);
  const normalizedDirectGrants = normalizeContainerDirectGrants(
    directGrants as ContainerDirectGrantV2[],
  );
  const normalizedReferencedPrincipalHeads = normalizeReferencedPrincipalHeads(
    referencedPrincipalHeads as ReferencedPrincipalHeadV2[],
  );

  assertReferencedPrincipalHeadsMatchDirectGrants({
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  });

  return {
    version: readVersion(record, "container access manifest state"),
    containerId: readString(
      record,
      "containerId",
      "container access manifest state",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "container access manifest state",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "container access manifest state",
    ),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "container access manifest state",
    ),
    eventHash: readHashString(
      record,
      "eventHash",
      "container access manifest state",
    ),
    ...structural,
    ...keyState,
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  };
}

export async function computeContainerAccessStructuralHash(
  structural: ContainerAccessStructuralV2,
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.container-access-structural.v1",
    normalizeContainerAccessStructural(
      structural,
    ) as unknown as KeyingV2CanonicalJson,
  );
}

export async function computeContainerDirectGrantRoot(
  grants: readonly ContainerDirectGrantV2[],
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.container-access-direct-grants.v1",
    normalizeContainerDirectGrants(grants) as unknown as KeyingV2CanonicalJson,
  );
}

export async function computeContainerAccessKeyTargetHash(
  keyState: ContainerAccessKeyStateV2,
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.container-access-key-target.v1",
    normalizeContainerAccessKeyState(
      keyState,
    ) as unknown as KeyingV2CanonicalJson,
  );
}

export async function deriveContainerAccessManifest(
  state: ContainerAccessManifestStateV2,
): Promise<AccessManifestV2> {
  const normalizedState = normalizeContainerAccessManifestState(state);

  return {
    version: 2,
    objectKind: "container",
    objectId: normalizedState.containerId,
    organizationId: normalizedState.organizationId,
    epoch: normalizedState.epoch,
    previousManifestHash: normalizedState.previousManifestHash,
    eventHash: normalizedState.eventHash,
    structuralHash: await computeContainerAccessStructuralHash({
      parentContainerId: normalizedState.parentContainerId,
      parentManifestHash: normalizedState.parentManifestHash,
    }),
    grantRoot: await computeContainerDirectGrantRoot(
      normalizedState.directGrants,
    ),
    referencedPrincipalHeads: normalizedState.referencedPrincipalHeads,
    keyTargetHash: await computeContainerAccessKeyTargetHash({
      containerKeyEpochId: normalizedState.containerKeyEpochId,
    }),
  };
}

function normalizeContainerCreateAccessEventBody(
  value: KeyingV2CanonicalJson,
): ContainerCreateAccessEventBodyV2 {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "directGrants",
      "eventType",
      "parentContainerId",
      "parentManifestHash",
      "referencedPrincipalHeads",
    ],
    "container.create event body",
  );
  const directGrants = record.directGrants;
  const referencedPrincipalHeads = record.referencedPrincipalHeads;

  if (!Array.isArray(directGrants)) {
    throwVerification(
      "invalid_shape",
      "container.create event body.directGrants must be an array",
    );
  }

  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "container.create event body.referencedPrincipalHeads must be an array",
    );
  }

  const structural = normalizeContainerAccessStructural({
    parentContainerId: record.parentContainerId,
    parentManifestHash: record.parentManifestHash,
  } as ContainerAccessStructuralV2);
  const keyState = normalizeContainerAccessKeyState({
    containerKeyEpochId: record.containerKeyEpochId,
  } as ContainerAccessKeyStateV2);
  const normalizedDirectGrants = normalizeContainerDirectGrants(
    directGrants as ContainerDirectGrantV2[],
  );
  const normalizedReferencedPrincipalHeads = normalizeReferencedPrincipalHeads(
    referencedPrincipalHeads as ReferencedPrincipalHeadV2[],
  );

  assertReferencedPrincipalHeadsMatchDirectGrants({
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  });

  return {
    eventType: "container.create",
    ...structural,
    ...keyState,
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  };
}

function normalizeContainerGrantAccessEventBody(
  value: KeyingV2CanonicalJson,
): ContainerGrantAccessEventBodyV2 {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId", "eventType", "grant", "referencedPrincipalHead"],
    "container.grant event body",
  );
  const grant = normalizeContainerDirectGrant(
    record.grant as ContainerDirectGrantV2,
  );
  const referencedPrincipalHead =
    record.referencedPrincipalHead === null
      ? null
      : normalizeReferencedPrincipalHead(
          record.referencedPrincipalHead as ReferencedPrincipalHeadV2,
        );
  const managedGrantKey = managedGrantReferenceKey(grant);

  if (managedGrantKey === null && referencedPrincipalHead !== null) {
    throwVerification(
      "missing_dependency",
      "container.grant user grants must not include a referenced principal head",
    );
  }

  if (
    managedGrantKey !== null &&
    (!referencedPrincipalHead ||
      referencedPrincipalKey(referencedPrincipalHead) !== managedGrantKey)
  ) {
    throwVerification(
      "missing_dependency",
      "container.grant managed-principal grants must include the matching referenced principal head",
    );
  }

  return {
    eventType: "container.grant",
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    } as ContainerAccessKeyStateV2),
    grant,
    referencedPrincipalHead,
  };
}

function normalizeContainerRevokeAccessEventBody(
  value: KeyingV2CanonicalJson,
): ContainerRevokeAccessEventBodyV2 {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId", "eventType", "subjectId", "subjectType"],
    "container.revoke event body",
  );

  return {
    eventType: "container.revoke",
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    } as ContainerAccessKeyStateV2),
    subjectId: readString(record, "subjectId", "container.revoke event body"),
    subjectType: normalizeContainerGrantSubjectType(
      record.subjectType,
      "container.revoke event body",
    ),
  };
}

function normalizeContainerMoveAccessEventBody(
  value: KeyingV2CanonicalJson,
): ContainerMoveAccessEventBodyV2 {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "eventType",
      "parentContainerId",
      "parentManifestHash",
    ],
    "container.move event body",
  );

  return {
    eventType: "container.move",
    ...normalizeContainerAccessStructural({
      parentContainerId: record.parentContainerId,
      parentManifestHash: record.parentManifestHash,
    } as ContainerAccessStructuralV2),
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    } as ContainerAccessKeyStateV2),
  };
}

export function normalizeContainerAccessEventBody(
  value: KeyingV2CanonicalJson,
): ContainerAccessEventBodyV2 {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "container access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "container access body");

  if (eventType === "container.create") {
    return normalizeContainerCreateAccessEventBody(value);
  }

  if (eventType === "container.grant") {
    return normalizeContainerGrantAccessEventBody(value);
  }

  if (eventType === "container.revoke") {
    return normalizeContainerRevokeAccessEventBody(value);
  }

  if (eventType === "container.move") {
    return normalizeContainerMoveAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "container access event body eventType is unsupported",
  );
}

function upsertContainerDirectGrant(
  grants: readonly ContainerDirectGrantV2[],
  grant: ContainerDirectGrantV2,
): ContainerDirectGrantV2[] {
  const nextGrants = grants.filter(
    (existingGrant) =>
      containerDirectGrantKey(existingGrant) !== containerDirectGrantKey(grant),
  );
  nextGrants.push(grant);
  return normalizeContainerDirectGrants(nextGrants);
}

function removeContainerDirectGrant(
  grants: readonly ContainerDirectGrantV2[],
  revokedGrant: Pick<ContainerDirectGrantV2, "subjectId" | "subjectType">,
): ContainerDirectGrantV2[] {
  const revokedGrantKey = `${revokedGrant.subjectType}:${revokedGrant.subjectId}`;
  return normalizeContainerDirectGrants(
    grants.filter(
      (existingGrant) =>
        containerDirectGrantKey(existingGrant) !== revokedGrantKey,
    ),
  );
}

function upsertReferencedPrincipalHead(
  principalHeads: readonly ReferencedPrincipalHeadV2[],
  principalHead: ReferencedPrincipalHeadV2,
): ReferencedPrincipalHeadV2[] {
  const nextPrincipalHeads = principalHeads.filter(
    (existingHead) =>
      referencedPrincipalKey(existingHead) !==
      referencedPrincipalKey(principalHead),
  );
  nextPrincipalHeads.push(principalHead);
  return normalizeReferencedPrincipalHeads(nextPrincipalHeads);
}

function removeReferencedPrincipalHead(
  principalHeads: readonly ReferencedPrincipalHeadV2[],
  revokedGrant: Pick<ContainerDirectGrantV2, "subjectId" | "subjectType">,
): ReferencedPrincipalHeadV2[] {
  if (revokedGrant.subjectType === "user") {
    return normalizeReferencedPrincipalHeads(principalHeads);
  }

  const revokedReferenceKey = `${revokedGrant.subjectType}:${revokedGrant.subjectId}`;
  return normalizeReferencedPrincipalHeads(
    principalHeads.filter(
      (principalHead) =>
        referencedPrincipalKey(principalHead) !== revokedReferenceKey,
    ),
  );
}

function requireContainerPathLast(
  path: readonly VerifiedContainerAccessManifest[] | undefined,
  label: string,
): VerifiedContainerAccessManifest {
  const lastManifest = path?.at(-1);
  if (!lastManifest) {
    throwVerification("missing_dependency", `${label} path is required`);
  }

  return lastManifest;
}

function requirePathLastMatchesManifest(input: {
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly label: string;
}): void {
  const lastManifest = requireContainerPathLast(input.path, input.label);

  if (lastManifest.manifestHash !== input.manifest.manifestHash) {
    throwVerification(
      "missing_dependency",
      `${input.label} path does not end at the expected manifest`,
    );
  }
}

function principalPolicyMatchesReference(input: {
  readonly policy: VerifiedPrincipalPolicy;
  readonly reference: ReferencedPrincipalHeadV2;
}): boolean {
  return (
    input.policy.principalType === input.reference.principalType &&
    input.policy.principalId === input.reference.principalId &&
    input.policy.version === input.reference.version &&
    input.policy.keyEpoch === input.reference.keyEpoch &&
    input.policy.stateHash === input.reference.stateHash &&
    input.policy.state.keyFingerprint === input.reference.keyFingerprint
  );
}

function grantAccessLevelForUser(input: {
  readonly grant: ContainerDirectGrantV2;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly state: ContainerAccessManifestStateV2;
  readonly userId: string;
}): ContainerAccessLevelV2 | null {
  if (input.grant.subjectType === "user") {
    return input.grant.subjectId === input.userId
      ? input.grant.accessLevel
      : null;
  }

  const referencedHead = input.state.referencedPrincipalHeads.find(
    (principalHead) =>
      principalHead.principalType === input.grant.subjectType &&
      principalHead.principalId === input.grant.subjectId,
  );

  if (!referencedHead) {
    return null;
  }

  const verifiedPolicy = input.principalPolicies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference: referencedHead }),
  );

  if (!verifiedPolicy) {
    return null;
  }

  return verifiedPolicy.projection.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === input.userId,
  )
    ? input.grant.accessLevel
    : null;
}

export function resolveContainerPathUserAccessLevel(input: {
  readonly path: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly userId: string;
}): ContainerAccessLevelV2 | null {
  let accessLevel: ContainerAccessLevelV2 | null = null;

  for (const containerManifest of input.path) {
    for (const grant of containerManifest.state.directGrants) {
      const grantAccessLevel = grantAccessLevelForUser({
        grant,
        principalPolicies: input.principalPolicies ?? [],
        state: containerManifest.state,
        userId: input.userId,
      });

      if (grantAccessLevel) {
        accessLevel = mergeContainerAccessLevel(accessLevel, grantAccessLevel);
      }
    }
  }

  return accessLevel;
}

function requireContainerPathUserAccess(input: {
  readonly label: string;
  readonly minimumAccessLevel: ContainerAccessLevelV2;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly userId: string;
}): void {
  const path = input.path;
  if (!path || path.length === 0) {
    throwVerification("missing_dependency", `${input.label} path is required`);
  }

  const accessLevel = resolveContainerPathUserAccessLevel({
    path,
    principalPolicies: input.principalPolicies,
    userId: input.userId,
  });

  if (
    accessLevel === null ||
    containerAccessLevelRank(accessLevel) <
      containerAccessLevelRank(input.minimumAccessLevel)
  ) {
    throwVerification(
      "unauthorized",
      `${input.label} signer lacks ${input.minimumAccessLevel} access`,
    );
  }
}

function requireContainerPathCurrentParent(input: {
  readonly parentContainerId: string | null;
  readonly parentManifestHash: string | null;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly label: string;
}): void {
  if (!input.parentContainerId || !input.parentManifestHash) {
    throwVerification(
      "missing_dependency",
      `${input.label} parent manifest is required`,
    );
  }

  const parentManifest = requireContainerPathLast(input.path, input.label);
  if (
    parentManifest.state.containerId !== input.parentContainerId ||
    parentManifest.manifestHash !== input.parentManifestHash
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} parent manifest hash mismatch`,
    );
  }
}

type ContainerAccessManifestDerivationInput = {
  readonly body: ContainerAccessEventBodyV2;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly previousContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly destinationParentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
};

type ContainerAccessManifestTransitionBase = Omit<
  ContainerAccessManifestStateV2,
  "containerKeyEpochId" | "directGrants" | "referencedPrincipalHeads"
>;

interface PreviousContainerAccessTransition {
  readonly nextBase: ContainerAccessManifestTransitionBase;
  readonly previousState: ContainerAccessManifestStateV2;
}

function assertContainerAccessEventDomain(
  input: ContainerAccessManifestDerivationInput,
): void {
  const { body, event } = input;

  if (event.event.objectKind !== "container") {
    throwVerification(
      "object_mismatch",
      "container access event must target a container",
    );
  }

  if (body.eventType !== event.event.eventType) {
    throwVerification(
      "invalid_domain",
      "container access event body type does not match event type",
    );
  }
}

function deriveContainerCreateManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerCreateAccessEventBodyV2,
): ContainerAccessManifestStateV2 {
  const { event, previousManifest } = input;

  if (previousManifest !== null || event.event.previousManifestHash !== null) {
    throwVerification(
      "stale_predecessor",
      "container.create must not have a previous manifest",
    );
  }

  requireContainerPathCurrentParent({
    label: "container.create",
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    path: input.parentContainerPath,
  });
  requireContainerPathUserAccess({
    label: "container.create",
    minimumAccessLevel: "write",
    path: input.parentContainerPath,
    principalPolicies: input.principalPolicies,
    userId: event.event.signerUserId,
  });

  return normalizeContainerAccessManifestState({
    version: 2,
    containerId: event.event.objectId,
    organizationId: event.event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  });
}

function preparePreviousContainerAccessTransition(
  input: ContainerAccessManifestDerivationInput,
): PreviousContainerAccessTransition {
  const { body, event, previousManifest } = input;

  if (!previousManifest) {
    throwVerification(
      "missing_dependency",
      `${body.eventType} requires the previous container manifest`,
    );
  }

  if (event.event.previousManifestHash !== previousManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "container access event previous manifest does not match supplied previous manifest",
    );
  }

  requirePathLastMatchesManifest({
    label: "previous container",
    manifest: previousManifest,
    path: input.previousContainerPath,
  });

  const previousState = previousManifest.state;

  return {
    previousState,
    nextBase: {
      version: 2,
      containerId: previousState.containerId,
      organizationId: previousState.organizationId,
      epoch: previousState.epoch + 1,
      previousManifestHash: previousManifest.manifestHash,
      eventHash: event.eventHash,
      parentContainerId: previousState.parentContainerId,
      parentManifestHash: previousState.parentManifestHash,
    },
  };
}

function deriveContainerGrantManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerGrantAccessEventBodyV2,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestStateV2 {
  requireContainerPathUserAccess({
    label: "container.grant",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (body.containerKeyEpochId !== previous.previousState.containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container.grant must keep the current container KEK epoch",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: upsertContainerDirectGrant(
      previous.previousState.directGrants,
      body.grant,
    ),
    referencedPrincipalHeads: body.referencedPrincipalHead
      ? upsertReferencedPrincipalHead(
          previous.previousState.referencedPrincipalHeads,
          body.referencedPrincipalHead,
        )
      : previous.previousState.referencedPrincipalHeads,
  });
}

function deriveContainerRevokeManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerRevokeAccessEventBodyV2,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestStateV2 {
  requireContainerPathUserAccess({
    label: "container.revoke",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    body.containerKeyEpochId === null ||
    body.containerKeyEpochId === previous.previousState.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container.revoke must create a new container KEK epoch",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: removeContainerDirectGrant(
      previous.previousState.directGrants,
      body,
    ),
    referencedPrincipalHeads: removeReferencedPrincipalHead(
      previous.previousState.referencedPrincipalHeads,
      body,
    ),
  });
}

function deriveContainerMoveManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerMoveAccessEventBodyV2,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestStateV2 {
  requireContainerPathUserAccess({
    label: "container.move source",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });
  requireContainerPathCurrentParent({
    label: "container.move destination",
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    path: input.destinationParentContainerPath,
  });
  requireContainerPathUserAccess({
    label: "container.move destination",
    minimumAccessLevel: "write",
    path: input.destinationParentContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    input.destinationParentContainerPath?.some(
      (containerManifest) =>
        containerManifest.state.containerId ===
        previous.previousState.containerId,
    )
  ) {
    throwVerification(
      "object_mismatch",
      "container.move destination parent cannot be the moved container or its descendant",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: previous.previousState.directGrants,
    referencedPrincipalHeads: previous.previousState.referencedPrincipalHeads,
  });
}

function deriveContainerAccessManifestStateFromEvent(
  input: ContainerAccessManifestDerivationInput,
): ContainerAccessManifestStateV2 {
  assertContainerAccessEventDomain(input);

  if (input.body.eventType === "container.create") {
    return deriveContainerCreateManifestState(input, input.body);
  }

  const previous = preparePreviousContainerAccessTransition(input);

  if (input.body.eventType === "container.grant") {
    return deriveContainerGrantManifestState(input, input.body, previous);
  }

  if (input.body.eventType === "container.revoke") {
    return deriveContainerRevokeManifestState(input, input.body, previous);
  }

  return deriveContainerMoveManifestState(input, input.body, previous);
}

export async function verifyContainerAccessManifest({
  destinationParentContainerPath,
  event,
  expectedManifestHash,
  manifest,
  parentContainerPath,
  previousContainerPath,
  previousManifest = null,
  principalPolicies = [],
}: VerifyContainerAccessManifestInput): Promise<
  KeyingV2VerificationResult<VerifiedContainerAccessManifest>
> {
  return runVerifier(async () => {
    const body = normalizeContainerAccessEventBody(event.body);
    const state = deriveContainerAccessManifestStateFromEvent({
      body,
      destinationParentContainerPath,
      event,
      parentContainerPath,
      previousContainerPath,
      previousManifest,
      principalPolicies,
    });
    const derivedManifest = await deriveContainerAccessManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);

    if (derivedManifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "container access manifest hash does not match derived state",
      );
    }

    const verifiedManifest = await verifyAccessManifest({
      manifest,
      expectedManifestHash,
      event,
      expectedObject: {
        objectKind: "container",
        objectId: state.containerId,
      },
      expectedPreviousManifestHash: state.previousManifestHash,
    });

    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }

    return {
      manifest: verifiedManifest.value.manifest,
      manifestHash: verifiedManifest.value.manifestHash,
      event,
      state,
    } as VerifiedContainerAccessManifest;
  });
}

function normalizeDocumentLinkSetStructural(
  value: DocumentLinkSetStructuralV2,
): DocumentLinkSetStructuralV2 {
  const record = assertExactKeys(
    value,
    ["linkedContainerIds"],
    "document link-set structural state",
  );
  const linkedContainerIds = normalizeUniqueSortedStrings(
    readStringArray(
      record,
      "linkedContainerIds",
      "document link-set structural state",
    ),
    "document link-set linkedContainerIds",
  );

  if (linkedContainerIds.length === 0) {
    throwVerification(
      "missing_dependency",
      "document link-set must include at least one linked container",
    );
  }

  return { linkedContainerIds };
}

function normalizeDocumentLinkSetManifestState(
  value: DocumentLinkSetManifestStateV2,
): DocumentLinkSetManifestStateV2 {
  const record = assertExactKeys(
    value,
    [
      "documentId",
      "epoch",
      "eventHash",
      "linkedContainerIds",
      "organizationId",
      "previousManifestHash",
      "version",
    ],
    "document link-set manifest state",
  );
  const structural = normalizeDocumentLinkSetStructural({
    linkedContainerIds: record.linkedContainerIds,
  } as DocumentLinkSetStructuralV2);

  return {
    version: readVersion(record, "document link-set manifest state"),
    documentId: readString(
      record,
      "documentId",
      "document link-set manifest state",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "document link-set manifest state",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "document link-set manifest state",
    ),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "document link-set manifest state",
    ),
    eventHash: readHashString(
      record,
      "eventHash",
      "document link-set manifest state",
    ),
    linkedContainerIds: structural.linkedContainerIds,
  };
}

export async function computeDocumentLinkSetStructuralHash(
  structural: DocumentLinkSetStructuralV2,
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.document-link-set-structural.v1",
    normalizeDocumentLinkSetStructural(
      structural,
    ) as unknown as KeyingV2CanonicalJson,
  );
}

export async function computeDocumentLinkSetGrantRoot(): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.document-link-set-grants.v1",
    { grants: [] },
  );
}

export async function computeDocumentLinkSetKeyTargetHash(): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.document-link-set-key-target.v1",
    { targetMode: "current-linked-container-keks" },
  );
}

export async function deriveDocumentLinkSetManifest(
  state: DocumentLinkSetManifestStateV2,
): Promise<AccessManifestV2> {
  const normalizedState = normalizeDocumentLinkSetManifestState(state);

  return {
    version: 2,
    objectKind: "document",
    objectId: normalizedState.documentId,
    organizationId: normalizedState.organizationId,
    epoch: normalizedState.epoch,
    previousManifestHash: normalizedState.previousManifestHash,
    eventHash: normalizedState.eventHash,
    structuralHash: await computeDocumentLinkSetStructuralHash({
      linkedContainerIds: normalizedState.linkedContainerIds,
    }),
    grantRoot: await computeDocumentLinkSetGrantRoot(),
    referencedPrincipalHeads: [],
    keyTargetHash: await computeDocumentLinkSetKeyTargetHash(),
  };
}

function normalizeDocumentLinkAccessEventBody(
  value: KeyingV2CanonicalJson,
): DocumentLinkAccessEventBodyV2 {
  const record = assertExactKeys(
    value,
    ["containerId", "containerManifestHash", "eventType"],
    "document.link event body",
  );

  return {
    eventType: "document.link",
    containerId: readString(record, "containerId", "document.link event body"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.link event body",
    ),
  };
}

function normalizeDocumentUnlinkAccessEventBody(
  value: KeyingV2CanonicalJson,
): DocumentUnlinkAccessEventBodyV2 {
  const record = assertExactKeys(
    value,
    ["containerId", "containerManifestHash", "eventType"],
    "document.unlink event body",
  );

  return {
    eventType: "document.unlink",
    containerId: readString(
      record,
      "containerId",
      "document.unlink event body",
    ),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.unlink event body",
    ),
  };
}

export function normalizeDocumentAccessEventBody(
  value: KeyingV2CanonicalJson,
): DocumentAccessEventBodyV2 {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "document access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "document access body");

  if (eventType === "document.link") {
    return normalizeDocumentLinkAccessEventBody(value);
  }

  if (eventType === "document.unlink") {
    return normalizeDocumentUnlinkAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "document access event body eventType is unsupported",
  );
}

function requireEventDependency(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifestHash: string;
  readonly label: string;
}): void {
  if (
    !input.event.event.dependencyManifestHashes.includes(input.manifestHash)
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} manifest hash is not signed as an event dependency`,
    );
  }
}

function requireContainerPathCurrentManifest(input: {
  readonly containerId: string;
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly manifestHash: string;
  readonly organizationId: string;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
}): VerifiedContainerAccessManifest {
  const manifest = requireContainerPathLast(input.path, input.label);

  if (
    manifest.state.containerId !== input.containerId ||
    manifest.manifestHash !== input.manifestHash
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} path does not end at the signed container manifest`,
    );
  }

  if (manifest.state.organizationId !== input.organizationId) {
    throwVerification(
      "object_mismatch",
      `${input.label} container belongs to the wrong organization`,
    );
  }

  requireEventDependency({
    event: input.event,
    manifestHash: input.manifestHash,
    label: input.label,
  });

  return manifest;
}

function requireContainerPathCurrentWriteAccess(input: {
  readonly containerId: string;
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly manifestHash: string;
  readonly organizationId: string;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): void {
  requireContainerPathCurrentManifest(input);
  requireContainerPathUserAccess({
    label: input.label,
    minimumAccessLevel: "write",
    path: input.path,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });
}

function requireAnyLinkedContainerWriteAccess(input: {
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  readonly paths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): void {
  const linkedContainerIds = new Set(input.linkedContainerIds);

  for (const path of input.paths ?? []) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      !linkedContainerIds.has(manifest.state.containerId) ||
      manifest.state.organizationId !== input.organizationId ||
      !input.event.event.dependencyManifestHashes.includes(
        manifest.manifestHash,
      )
    ) {
      continue;
    }

    const accessLevel = resolveContainerPathUserAccessLevel({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.event.event.signerUserId,
    });

    if (
      accessLevel !== null &&
      containerAccessLevelRank(accessLevel) >= containerAccessLevelRank("write")
    ) {
      return;
    }
  }

  throwVerification(
    "unauthorized",
    `${input.label} signer lacks write access through a signed linked container dependency`,
  );
}

type DocumentLinkSetManifestDerivationInput = {
  readonly body: DocumentAccessEventBodyV2;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedDocumentLinkSetManifest | null;
  readonly targetContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly authorizingContainerPaths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
};

interface PreviousDocumentLinkSetTransition {
  readonly nextBase: Omit<DocumentLinkSetManifestStateV2, "linkedContainerIds">;
  readonly previousState: DocumentLinkSetManifestStateV2;
}

function assertDocumentAccessEventDomain(
  input: DocumentLinkSetManifestDerivationInput,
): void {
  const { body, event } = input;

  if (event.event.objectKind !== "document") {
    throwVerification(
      "object_mismatch",
      "document access event must target a document",
    );
  }

  if (body.eventType !== event.event.eventType) {
    throwVerification(
      "invalid_domain",
      "document access event body type does not match event type",
    );
  }
}

function preparePreviousDocumentLinkSetTransition(
  input: DocumentLinkSetManifestDerivationInput,
): PreviousDocumentLinkSetTransition {
  const { event, previousManifest } = input;

  if (!previousManifest) {
    throwVerification(
      "missing_dependency",
      `${input.body.eventType} requires the previous document link-set manifest`,
    );
  }

  if (event.event.previousManifestHash !== previousManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "document access event previous manifest does not match supplied previous manifest",
    );
  }

  if (
    previousManifest.state.documentId !== event.event.objectId ||
    previousManifest.state.organizationId !== event.event.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "document access previous manifest targets the wrong document",
    );
  }

  return {
    previousState: previousManifest.state,
    nextBase: {
      version: 2,
      documentId: previousManifest.state.documentId,
      organizationId: previousManifest.state.organizationId,
      epoch: previousManifest.state.epoch + 1,
      previousManifestHash: previousManifest.manifestHash,
      eventHash: event.eventHash,
    },
  };
}

function deriveInitialDocumentLinkSetManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentLinkAccessEventBodyV2,
): DocumentLinkSetManifestStateV2 {
  if (input.event.event.previousManifestHash !== null) {
    throwVerification(
      "stale_predecessor",
      "initial document.link must not have a previous manifest",
    );
  }

  requireContainerPathCurrentWriteAccess({
    containerId: body.containerId,
    event: input.event,
    label: "document.link target",
    manifestHash: body.containerManifestHash,
    organizationId: input.event.event.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    version: 2,
    documentId: input.event.event.objectId,
    organizationId: input.event.event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: input.event.eventHash,
    linkedContainerIds: [body.containerId],
  });
}

function deriveDocumentLinkManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentLinkAccessEventBodyV2,
  previous: PreviousDocumentLinkSetTransition,
): DocumentLinkSetManifestStateV2 {
  if (previous.previousState.linkedContainerIds.includes(body.containerId)) {
    throwVerification(
      "duplicate_entry",
      "document.link target container is already linked",
    );
  }

  requireAnyLinkedContainerWriteAccess({
    event: input.event,
    label: "document.link existing access",
    linkedContainerIds: previous.previousState.linkedContainerIds,
    organizationId: previous.previousState.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });
  requireContainerPathCurrentWriteAccess({
    containerId: body.containerId,
    event: input.event,
    label: "document.link target",
    manifestHash: body.containerManifestHash,
    organizationId: previous.previousState.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    ...previous.nextBase,
    linkedContainerIds: [
      ...previous.previousState.linkedContainerIds,
      body.containerId,
    ],
  });
}

function deriveDocumentUnlinkManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentUnlinkAccessEventBodyV2,
  previous: PreviousDocumentLinkSetTransition,
): DocumentLinkSetManifestStateV2 {
  if (!previous.previousState.linkedContainerIds.includes(body.containerId)) {
    throwVerification(
      "missing_dependency",
      "document.unlink target container is not linked",
    );
  }

  const remainingLinkedContainerIds =
    previous.previousState.linkedContainerIds.filter(
      (containerId) => containerId !== body.containerId,
    );

  if (remainingLinkedContainerIds.length === 0) {
    throwVerification(
      "missing_dependency",
      "document.unlink must leave at least one linked container",
    );
  }

  requireContainerPathCurrentWriteAccess({
    containerId: body.containerId,
    event: input.event,
    label: "document.unlink target",
    manifestHash: body.containerManifestHash,
    organizationId: previous.previousState.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });
  requireAnyLinkedContainerWriteAccess({
    event: input.event,
    label: "document.unlink remaining access",
    linkedContainerIds: remainingLinkedContainerIds,
    organizationId: previous.previousState.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    ...previous.nextBase,
    linkedContainerIds: remainingLinkedContainerIds,
  });
}

function deriveDocumentLinkSetManifestStateFromEvent(
  input: DocumentLinkSetManifestDerivationInput,
): DocumentLinkSetManifestStateV2 {
  assertDocumentAccessEventDomain(input);

  if (input.body.eventType === "document.link" && !input.previousManifest) {
    return deriveInitialDocumentLinkSetManifestState(input, input.body);
  }

  const previous = preparePreviousDocumentLinkSetTransition(input);

  if (input.body.eventType === "document.link") {
    return deriveDocumentLinkManifestState(input, input.body, previous);
  }

  return deriveDocumentUnlinkManifestState(input, input.body, previous);
}

export async function verifyDocumentLinkSetManifest({
  authorizingContainerPaths,
  event,
  expectedManifestHash,
  manifest,
  previousManifest = null,
  principalPolicies = [],
  targetContainerPath,
}: VerifyDocumentLinkSetManifestInput): Promise<
  KeyingV2VerificationResult<VerifiedDocumentLinkSetManifest>
> {
  return runVerifier(async () => {
    const body = normalizeDocumentAccessEventBody(event.body);
    const state = deriveDocumentLinkSetManifestStateFromEvent({
      authorizingContainerPaths,
      body,
      event,
      previousManifest,
      principalPolicies,
      targetContainerPath,
    });
    const derivedManifest = await deriveDocumentLinkSetManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);

    if (derivedManifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "document link-set manifest hash does not match derived state",
      );
    }

    const verifiedManifest = await verifyAccessManifest({
      manifest,
      expectedManifestHash,
      event,
      expectedObject: {
        objectKind: "document",
        objectId: state.documentId,
      },
      expectedPreviousManifestHash: state.previousManifestHash,
    });

    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }

    return {
      manifest: verifiedManifest.value.manifest,
      manifestHash: verifiedManifest.value.manifestHash,
      event,
      state,
    } as VerifiedDocumentLinkSetManifest;
  });
}

export function verifyContainerParentEdge({
  child,
  parentHistory,
}: VerifyContainerParentEdgeInput): KeyingV2VerificationResult<VerifiedContainerParentEdge> {
  try {
    if (!child.state.parentContainerId || !child.state.parentManifestHash) {
      throwVerification(
        "missing_dependency",
        "container parent edge requires a parent manifest hash",
      );
    }

    if (parentHistory.length === 0) {
      throwVerification(
        "missing_dependency",
        "container parent edge requires parent manifest history",
      );
    }

    for (const parentManifest of parentHistory) {
      if (parentManifest.state.containerId !== child.state.parentContainerId) {
        throwVerification(
          "object_mismatch",
          "container parent edge history contains the wrong parent container",
        );
      }
    }

    if (
      !parentHistory.some(
        (parentManifest) =>
          parentManifest.manifestHash === child.state.parentManifestHash,
      )
    ) {
      throwVerification(
        "missing_dependency",
        "container parent manifest hash is not present in parent history",
      );
    }

    return ok({
      childContainerId: child.state.containerId,
      childManifestHash: child.manifestHash,
      parentContainerId: child.state.parentContainerId,
      parentManifestHash: child.state.parentManifestHash,
    } as VerifiedContainerParentEdge);
  } catch (error) {
    return toVerificationResult(error);
  }
}

function normalizeContainerKeyEpoch(
  value: ContainerKeyEpochV2,
): ContainerKeyEpochV2 {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "containerId",
      "createdByEventHash",
      "createdByManifestHash",
      "id",
      "keyEpoch",
      "parentContainerKeyEpochId",
    ],
    "container key epoch",
  );

  return {
    id: readString(record, "id", "container key epoch"),
    containerId: readString(record, "containerId", "container key epoch"),
    keyEpoch: readPositiveInteger(record, "keyEpoch", "container key epoch"),
    accessManifestHash: readHashString(
      record,
      "accessManifestHash",
      "container key epoch",
    ),
    parentContainerKeyEpochId: readNullableString(
      record,
      "parentContainerKeyEpochId",
      "container key epoch",
    ),
    createdByEventHash: readHashString(
      record,
      "createdByEventHash",
      "container key epoch",
    ),
    createdByManifestHash: readHashString(
      record,
      "createdByManifestHash",
      "container key epoch",
    ),
  };
}

function normalizeContainerKeyWrap(
  value: ContainerKeyWrapV2,
): ContainerKeyWrapV2 {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "kemCipherText",
      "recipientId",
      "recipientKeyEpochId",
      "recipientKeyFingerprint",
      "recipientKind",
      "wrapManifestHash",
      "wrappedKey",
    ],
    "container key wrap",
  );

  return {
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "container key wrap",
    ),
    recipientKind: normalizeKekRecipientKind(
      record.recipientKind,
      "container key wrap",
    ),
    recipientId: readString(record, "recipientId", "container key wrap"),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container key wrap",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container key wrap",
    ),
    kemCipherText: readString(record, "kemCipherText", "container key wrap"),
    wrappedKey: readString(record, "wrappedKey", "container key wrap"),
    wrapManifestHash: readHashString(
      record,
      "wrapManifestHash",
      "container key wrap",
    ),
  };
}

function normalizeContainerUserRecipientKey(
  value: ContainerUserRecipientKeyV2,
): ContainerUserRecipientKeyV2 {
  const record = assertExactKeys(
    value,
    ["recipientKeyEpochId", "recipientKeyFingerprint", "userId"],
    "container user recipient key",
  );

  return {
    userId: readString(record, "userId", "container user recipient key"),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container user recipient key",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container user recipient key",
    ),
  };
}

function containerKeyWrapTarget(
  wrap: ContainerKeyWrapV2,
): ContainerKekRecipientTargetV2 {
  return {
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
  };
}

function containerKeyWrapKey(wrap: ContainerKeyWrapV2): string {
  return `${wrap.containerKeyEpochId}:${containerKekRecipientTargetKey(containerKeyWrapTarget(wrap))}`;
}

export function derivePrincipalRecipientKeyEpochId(
  reference: ReferencedPrincipalHeadV2,
): string {
  const normalizedReference = normalizeReferencedPrincipalHead(reference);

  return [
    normalizedReference.principalType,
    normalizedReference.principalId,
    normalizedReference.keyEpoch,
    normalizedReference.stateHash,
  ].join(":");
}

export async function computeContainerKeyEpochHash(
  keyEpoch: ContainerKeyEpochV2,
): Promise<string> {
  return computeKeyingV2DomainHash(
    "tearleads.keying-v2.container-key-epoch.v1",
    normalizeContainerKeyEpoch(keyEpoch) as unknown as KeyingV2CanonicalJson,
  );
}

function buildContainerUserRecipientKeyMap(
  userRecipientKeys: readonly ContainerUserRecipientKeyV2[],
): Map<string, ContainerUserRecipientKeyV2> {
  const userKeyByUserId = new Map<string, ContainerUserRecipientKeyV2>();

  for (const userKey of userRecipientKeys.map(
    normalizeContainerUserRecipientKey,
  )) {
    if (userKeyByUserId.has(userKey.userId)) {
      throwVerification(
        "duplicate_entry",
        "container user recipient keys contain a duplicate user",
      );
    }

    userKeyByUserId.set(userKey.userId, userKey);
  }

  return userKeyByUserId;
}

function requirePrincipalRecipientTarget(input: {
  readonly grant: ContainerDirectGrantV2;
  readonly state: ContainerAccessManifestStateV2;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): ContainerKekRecipientTargetV2 {
  if (input.grant.subjectType === "user") {
    throwVerification(
      "invalid_domain",
      "user grants do not have principal recipient targets",
    );
  }

  const referencedHead = input.state.referencedPrincipalHeads.find(
    (principalHead) =>
      principalHead.principalType === input.grant.subjectType &&
      principalHead.principalId === input.grant.subjectId,
  );

  if (!referencedHead) {
    throwVerification(
      "missing_dependency",
      "container KEK target derivation requires a referenced principal head",
    );
  }

  const verifiedPolicy = input.principalPolicies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference: referencedHead }),
  );

  if (!verifiedPolicy) {
    throwVerification(
      "missing_dependency",
      "container KEK target derivation requires the verified principal policy",
    );
  }

  return {
    recipientKind: referencedHead.principalType,
    recipientId: referencedHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(referencedHead),
    recipientKeyFingerprint: referencedHead.keyFingerprint,
  };
}

function deriveContainerKekRecipientTargetsOrThrow({
  containerManifest,
  parentKekState = null,
  principalPolicies = [],
  userRecipientKeys = [],
}: DeriveContainerKekRecipientTargetsInput): ContainerKekRecipientTargetV2[] {
  const targets: ContainerKekRecipientTargetV2[] = [];
  const userKeyByUserId = buildContainerUserRecipientKeyMap(userRecipientKeys);

  for (const grant of containerManifest.state.directGrants) {
    if (grant.subjectType === "user") {
      const userKey = userKeyByUserId.get(grant.subjectId);

      if (!userKey) {
        throwVerification(
          "missing_dependency",
          "container KEK target derivation requires a user recipient key",
        );
      }

      targets.push({
        recipientKind: "user",
        recipientId: grant.subjectId,
        recipientKeyEpochId: userKey.recipientKeyEpochId,
        recipientKeyFingerprint: userKey.recipientKeyFingerprint,
      });
      continue;
    }

    targets.push(
      requirePrincipalRecipientTarget({
        grant,
        state: containerManifest.state,
        principalPolicies,
      }),
    );
  }

  if (containerManifest.state.parentContainerId) {
    if (!parentKekState) {
      throwVerification(
        "missing_dependency",
        "container KEK target derivation requires verified parent KEK state",
      );
    }

    if (
      parentKekState.containerId !== containerManifest.state.parentContainerId
    ) {
      throwVerification(
        "object_mismatch",
        "container KEK parent target points at the wrong parent container",
      );
    }

    targets.push({
      recipientKind: "container",
      recipientId: parentKekState.containerId,
      recipientKeyEpochId: parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: parentKekState.keyEpochHash,
    });
  }

  return normalizeSortedUniqueArray(
    targets,
    normalizeContainerKekRecipientTarget,
    containerKekRecipientTargetKey,
    "container KEK recipient targets",
  );
}

export function deriveContainerKekRecipientTargets(
  input: DeriveContainerKekRecipientTargetsInput,
): KeyingV2VerificationResult<readonly ContainerKekRecipientTargetV2[]> {
  try {
    return ok(deriveContainerKekRecipientTargetsOrThrow(input));
  } catch (error) {
    return toVerificationResult(error);
  }
}

function buildAuthorizedContainerManifestMap(input: {
  readonly current: VerifiedContainerAccessManifest;
  readonly history: readonly VerifiedContainerAccessManifest[];
  readonly keyEpochId: string;
}): Map<string, VerifiedContainerAccessManifest> {
  const manifestByHash = new Map<string, VerifiedContainerAccessManifest>();

  for (const manifest of [...input.history, input.current]) {
    if (manifest.state.containerId !== input.current.state.containerId) {
      throwVerification(
        "object_mismatch",
        "container KEK history contains the wrong container",
      );
    }

    if (manifestByHash.has(manifest.manifestHash)) {
      throwVerification(
        "duplicate_entry",
        "container KEK history contains a duplicate manifest",
      );
    }

    if (manifest.state.containerKeyEpochId === input.keyEpochId) {
      manifestByHash.set(manifest.manifestHash, manifest);
    }
  }

  return manifestByHash;
}

function assertContainerKeyEpochManifestBinding(input: {
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly manifestByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  const accessManifest = input.manifestByHash.get(
    input.keyEpoch.accessManifestHash,
  );
  const createdByManifest = input.manifestByHash.get(
    input.keyEpoch.createdByManifestHash,
  );

  if (!accessManifest || !createdByManifest) {
    throwVerification(
      "missing_dependency",
      "container key epoch requires verified creation manifest history",
    );
  }

  if (createdByManifest.event.eventHash !== input.keyEpoch.createdByEventHash) {
    throwVerification(
      "hash_mismatch",
      "container key epoch created-by event hash does not match manifest",
    );
  }
}

function assertContainerKeyEpochParentBinding(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly parentKekState: VerifiedContainerKekState | null | undefined;
}): void {
  if (!input.containerManifest.state.parentContainerId) {
    if (input.keyEpoch.parentContainerKeyEpochId !== null) {
      throwVerification(
        "object_mismatch",
        "root container key epoch must not name a parent key epoch",
      );
    }

    return;
  }

  if (!input.parentKekState) {
    throwVerification(
      "missing_dependency",
      "container key epoch requires verified parent KEK state",
    );
  }

  if (
    input.parentKekState.containerId !==
    input.containerManifest.state.parentContainerId
  ) {
    throwVerification(
      "object_mismatch",
      "container key epoch parent state is for the wrong container",
    );
  }

  if (
    input.keyEpoch.parentContainerKeyEpochId !==
    input.parentKekState.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container key epoch parent edge points at the wrong parent key epoch",
    );
  }
}

function deriveTargetsForWrapManifest(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly targetsByManifestHash: Map<string, ContainerKekRecipientTargetV2[]>;
  readonly userRecipientKeys: readonly ContainerUserRecipientKeyV2[];
}): ContainerKekRecipientTargetV2[] {
  const cachedTargets = input.targetsByManifestHash.get(
    input.manifest.manifestHash,
  );

  if (cachedTargets) {
    return cachedTargets;
  }

  const targets = deriveContainerKekRecipientTargetsOrThrow({
    containerManifest: input.manifest,
    parentKekState: input.parentKekState,
    principalPolicies: input.principalPolicies,
    userRecipientKeys: input.userRecipientKeys,
  });
  input.targetsByManifestHash.set(input.manifest.manifestHash, targets);

  return targets;
}

function assertWrapJustifiedByTargets(input: {
  readonly wrap: ContainerKeyWrapV2;
  readonly targets: readonly ContainerKekRecipientTargetV2[];
}): void {
  const wrapTarget = containerKeyWrapTarget(input.wrap);
  const matchingTarget = input.targets.find(
    (target) =>
      containerKekRecipientTargetKey(target) ===
      containerKekRecipientTargetKey(wrapTarget),
  );

  if (!matchingTarget) {
    throwVerification(
      "missing_dependency",
      "container key wrap is not justified by its manifest",
    );
  }

  if (
    matchingTarget.recipientKeyFingerprint !==
    wrapTarget.recipientKeyFingerprint
  ) {
    throwVerification(
      "hash_mismatch",
      "container key wrap recipient fingerprint does not match justified target",
    );
  }
}

function assertContainerKeyEpochMatchesManifest(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpochV2;
}): void {
  const containerKeyEpochId = input.containerManifest.state.containerKeyEpochId;

  if (containerKeyEpochId === null) {
    throwVerification(
      "missing_dependency",
      "container KEK state requires a container key epoch id",
    );
  }

  if (input.keyEpoch.id !== containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container KEK state does not match the current access manifest",
    );
  }

  if (
    input.keyEpoch.containerId !== input.containerManifest.state.containerId
  ) {
    throwVerification(
      "object_mismatch",
      "container key epoch belongs to the wrong container",
    );
  }
}

function verifyContainerKeyWraps(input: {
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly manifestByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly targetsByManifestHash: Map<string, ContainerKekRecipientTargetV2[]>;
  readonly userRecipientKeys: readonly ContainerUserRecipientKeyV2[];
  readonly wraps: readonly ContainerKeyWrapV2[];
}): {
  readonly normalizedWraps: ContainerKeyWrapV2[];
  readonly wrapByTargetKey: Map<string, ContainerKeyWrapV2>;
} {
  const normalizedWraps = normalizeSortedUniqueArray(
    input.wraps,
    normalizeContainerKeyWrap,
    containerKeyWrapKey,
    "container key wraps",
  );
  const wrapByTargetKey = new Map<string, ContainerKeyWrapV2>();

  for (const wrap of normalizedWraps) {
    if (wrap.containerKeyEpochId !== input.keyEpoch.id) {
      throwVerification(
        "object_mismatch",
        "container key wrap belongs to the wrong key epoch",
      );
    }

    const wrapManifest = input.manifestByHash.get(wrap.wrapManifestHash);
    if (!wrapManifest) {
      throwVerification(
        "missing_dependency",
        "container key wrap manifest is not in verified history",
      );
    }

    const targets = deriveTargetsForWrapManifest({
      manifest: wrapManifest,
      parentKekState: input.parentKekState,
      principalPolicies: input.principalPolicies,
      targetsByManifestHash: input.targetsByManifestHash,
      userRecipientKeys: input.userRecipientKeys,
    });
    assertWrapJustifiedByTargets({ wrap, targets });

    wrapByTargetKey.set(
      containerKekRecipientTargetKey(containerKeyWrapTarget(wrap)),
      wrap,
    );
  }

  return { normalizedWraps, wrapByTargetKey };
}

function assertContainerKeyWrapsMatchTargets(input: {
  readonly recipientTargets: readonly ContainerKekRecipientTargetV2[];
  readonly wrapByTargetKey: ReadonlyMap<string, ContainerKeyWrapV2>;
}): void {
  for (const target of input.recipientTargets) {
    const wrap = input.wrapByTargetKey.get(
      containerKekRecipientTargetKey(target),
    );

    if (!wrap) {
      throwVerification(
        "missing_dependency",
        "container KEK state is missing a required key wrap",
      );
    }

    if (wrap.recipientKeyFingerprint !== target.recipientKeyFingerprint) {
      throwVerification(
        "hash_mismatch",
        "container key wrap recipient fingerprint does not match verified target",
      );
    }
  }

  if (input.wrapByTargetKey.size !== input.recipientTargets.length) {
    throwVerification(
      "missing_dependency",
      "container KEK state contains an extra key wrap",
    );
  }
}

async function buildVerifiedContainerKekState(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly normalizedWraps: readonly ContainerKeyWrapV2[];
  readonly recipientTargets: readonly ContainerKekRecipientTargetV2[];
}): Promise<VerifiedContainerKekState> {
  return {
    containerId: input.containerManifest.state.containerId,
    accessManifestHash: input.containerManifest.manifestHash,
    containerKeyEpochId: input.keyEpoch.id,
    containerKeyEpoch: input.keyEpoch.keyEpoch,
    keyEpoch: input.keyEpoch,
    keyEpochHash: await computeContainerKeyEpochHash(input.keyEpoch),
    parentContainerKeyEpochId: input.keyEpoch.parentContainerKeyEpochId,
    keyTargetHash: await computeContainerKekRecipientTargetHash(
      input.recipientTargets,
    ),
    recipientTargets: input.recipientTargets,
    wraps: input.normalizedWraps,
  } as unknown as VerifiedContainerKekState;
}

export async function verifyContainerKekState({
  containerManifest,
  containerManifestHistory = [],
  keyEpoch,
  parentKekState = null,
  principalPolicies = [],
  userRecipientKeys = [],
  wraps,
}: VerifyContainerKekStateInput): Promise<
  KeyingV2VerificationResult<VerifiedContainerKekState>
> {
  return runVerifier(async () => {
    const normalizedKeyEpoch = normalizeContainerKeyEpoch(keyEpoch);
    assertContainerKeyEpochMatchesManifest({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
    });

    assertContainerKeyEpochParentBinding({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
      parentKekState,
    });

    const manifestByHash = buildAuthorizedContainerManifestMap({
      current: containerManifest,
      history: containerManifestHistory,
      keyEpochId: normalizedKeyEpoch.id,
    });
    assertContainerKeyEpochManifestBinding({
      keyEpoch: normalizedKeyEpoch,
      manifestByHash,
    });

    const recipientTargets = deriveContainerKekRecipientTargetsOrThrow({
      containerManifest,
      parentKekState,
      principalPolicies,
      userRecipientKeys,
    });
    const targetsByManifestHash = new Map<
      string,
      ContainerKekRecipientTargetV2[]
    >([[containerManifest.manifestHash, recipientTargets]]);
    const { normalizedWraps, wrapByTargetKey } = verifyContainerKeyWraps({
      keyEpoch: normalizedKeyEpoch,
      manifestByHash,
      parentKekState,
      principalPolicies,
      targetsByManifestHash,
      userRecipientKeys,
      wraps,
    });
    assertContainerKeyWrapsMatchTargets({
      recipientTargets,
      wrapByTargetKey,
    });

    return buildVerifiedContainerKekState({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
      normalizedWraps,
      recipientTargets,
    });
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

function uniqueContainerManifestMap(
  manifests: readonly VerifiedContainerAccessManifest[],
): Map<string, VerifiedContainerAccessManifest> {
  const manifestByContainerId = new Map<
    string,
    VerifiedContainerAccessManifest
  >();

  for (const containerManifest of manifests) {
    if (manifestByContainerId.has(containerManifest.state.containerId)) {
      throwVerification(
        "duplicate_entry",
        "document KEK target derivation contains a duplicate container manifest",
      );
    }
    manifestByContainerId.set(
      containerManifest.state.containerId,
      containerManifest,
    );
  }

  return manifestByContainerId;
}

function uniqueContainerKekStateMap(
  states: readonly VerifiedContainerKekState[],
): Map<string, VerifiedContainerKekState> {
  const kekStateByContainerId = new Map<string, VerifiedContainerKekState>();

  for (const kekState of states) {
    if (kekStateByContainerId.has(kekState.containerId)) {
      throwVerification(
        "duplicate_entry",
        "document KEK target derivation contains a duplicate container KEK state",
      );
    }
    kekStateByContainerId.set(kekState.containerId, kekState);
  }

  return kekStateByContainerId;
}

function deriveLinkedDocumentKekTarget(input: {
  readonly containerId: string;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly manifestByContainerId: ReadonlyMap<
    string,
    VerifiedContainerAccessManifest
  >;
  readonly kekStateByContainerId: ReadonlyMap<
    string,
    VerifiedContainerKekState
  >;
}): DocumentContentKeyTargetV2 {
  const containerManifest = input.manifestByContainerId.get(input.containerId);
  const kekState = input.kekStateByContainerId.get(input.containerId);

  if (!containerManifest || !kekState) {
    throwVerification(
      "missing_dependency",
      "document KEK target derivation is missing a linked container target",
    );
  }

  if (
    containerManifest.state.organizationId !==
      input.documentManifest.state.organizationId ||
    kekState.containerId !== input.containerId
  ) {
    throwVerification(
      "object_mismatch",
      "document KEK target belongs to the wrong document organization or container",
    );
  }

  if (kekState.accessManifestHash !== containerManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "document KEK target container manifest is stale",
    );
  }

  if (
    containerManifest.state.containerKeyEpochId === null ||
    kekState.containerKeyEpochId !== containerManifest.state.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "document KEK target container key epoch does not match the manifest",
    );
  }

  return {
    containerId: input.containerId,
    containerManifestHash: containerManifest.manifestHash,
    containerKeyEpochId: kekState.containerKeyEpochId,
    containerKeyEpoch: kekState.containerKeyEpoch,
  };
}

async function buildVerifiedDocumentKekTargets(input: {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly targets: readonly DocumentContentKeyTargetV2[];
}): Promise<VerifiedDocumentKekTargets> {
  return {
    documentId: input.documentManifest.state.documentId,
    linkSetManifestHash: input.documentManifest.manifestHash,
    linkedContainerManifestHashes: input.targets.map(
      (target) => target.containerManifestHash,
    ),
    linkedContainerKeyEpochIds: input.targets.map(
      (target) => target.containerKeyEpochId,
    ),
    targets: input.targets,
    documentKeyTargetHash: await computeDocumentContentKeyTargetHash(
      input.targets,
    ),
  } as unknown as VerifiedDocumentKekTargets;
}

export async function deriveDocumentKekTargets({
  containerKekStates,
  documentManifest,
  linkedContainerManifests,
}: DeriveDocumentKekTargetsInput): Promise<
  KeyingV2VerificationResult<VerifiedDocumentKekTargets>
> {
  return runVerifier(async () => {
    const manifestByContainerId = uniqueContainerManifestMap(
      linkedContainerManifests,
    );
    const kekStateByContainerId =
      uniqueContainerKekStateMap(containerKekStates);

    const normalizedTargets = normalizeSortedUniqueArray(
      documentManifest.state.linkedContainerIds.map((containerId) =>
        deriveLinkedDocumentKekTarget({
          containerId,
          documentManifest,
          manifestByContainerId,
          kekStateByContainerId,
        }),
      ),
      (target) =>
        normalizeContainerKekTarget(target, "document content-key target"),
      containerKekTargetKey,
      "document content-key targets",
    );

    return buildVerifiedDocumentKekTargets({
      documentManifest,
      targets: normalizedTargets,
    });
  });
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
