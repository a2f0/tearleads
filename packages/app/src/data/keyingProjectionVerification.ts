import {
  type AccessEvent,
  type AccessManifest,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  type DocumentLinkAccessEventBody,
  type DocumentUnlinkAccessEventBody,
  type KeyingCanonicalJson,
  serializeKeyingCanonicalJson,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  type VerifiedContainerKekState,
  type VerifiedDocumentLinkSetManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  AccessManifestBundleWireResponse,
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
  EncapsulationKeyResponse,
} from "@tearleads/validators/response";
import { readCanonicalJson, readCanonicalRecord } from "./keyingCanonicalJson";

export interface ProjectionUserKey {
  readonly encapsulationPublicKey: Uint8Array;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}

export type ProjectionUserKeyResolver = (
  userId: string,
) => Promise<ProjectionUserKey | null>;

interface ProjectionUserKeyRuntime {
  readonly apiClient: {
    getEncapsulationKey(
      userId: string,
    ): Promise<EncapsulationKeyResponse | null>;
  };
  readonly encapsulationKeyPair?: { readonly publicKey: Uint8Array } | null;
  readonly log?: (message: string) => void;
  readonly signingFingerprint?: string | null;
  readonly signingKeyPair?:
    | { readonly signingPublicKey: Uint8Array }
    | null
    | undefined;
  readonly userId?: string | null;
}

export function createProjectionUserKeyResolver(
  runtime: ProjectionUserKeyRuntime,
  logPrefix: string,
): ProjectionUserKeyResolver {
  const cache = new Map<string, Promise<ProjectionUserKey | null>>();

  return async (userId) => {
    if (
      userId === runtime.userId &&
      runtime.signingKeyPair &&
      runtime.encapsulationKeyPair
    ) {
      const signingFingerprint = await toFingerprint(
        runtime.signingKeyPair.signingPublicKey,
      );
      if (
        runtime.signingFingerprint &&
        runtime.signingFingerprint !== signingFingerprint
      ) {
        return null;
      }

      return {
        encapsulationPublicKey: runtime.encapsulationKeyPair.publicKey,
        signingPublicKey: runtime.signingKeyPair.signingPublicKey,
        userId,
      };
    }

    let cached = cache.get(userId);
    if (!cached) {
      cached = runtime.apiClient
        .getEncapsulationKey(userId)
        .then(async (response) => {
          if (!response) {
            return null;
          }

          const signingPublicKey = base64ToBytes(response.signingPublicKey);
          const signingKeyFingerprint = await toFingerprint(signingPublicKey);
          if (
            response.userId !== userId ||
            response.signingKeyFingerprint !== signingKeyFingerprint
          ) {
            runtime.log?.(
              `${logPrefix}: skipped projection key for ${userId} because the signing fingerprint does not match the public key.`,
            );
            return null;
          }

          return {
            encapsulationPublicKey: base64ToBytes(
              response.encapsulationPublicKey,
            ),
            signingPublicKey,
            userId,
          };
        })
        .catch(() => {
          runtime.log?.(
            `${logPrefix}: skipped projection key for ${userId} because it could not be loaded.`,
          );
          return null;
        });
      cache.set(userId, cached);
    }

    return cached;
  };
}

function readRecordString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
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
  const value = record[key];
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
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}.${key} must be a positive integer`);
  }
  return value;
}

function readRecordValue(
  record: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  if (!Reflect.has(record, key)) {
    throw new Error(`${label}.${key} is missing`);
  }
  return record[key];
}

function readStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`${label} must be a string array`);
  }

  return [...value];
}

function isAccessEventType(value: unknown): value is AccessEvent["eventType"] {
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

function isAccessObjectKind(
  value: unknown,
): value is AccessEvent["objectKind"] {
  return value === "blob" || value === "container" || value === "document";
}

function isRecipientKind(
  value: unknown,
): value is ContainerKekRecipientTarget["recipientKind"] {
  return (
    value === "container" ||
    value === "group" ||
    value === "organization" ||
    value === "user"
  );
}

function readAccessEvent(value: unknown, label: string): AccessEvent {
  const record = readCanonicalRecord(value, label);
  const eventType = readRecordValue(record, "eventType", label);
  const objectKind = readRecordValue(record, "objectKind", label);
  if (!isAccessEventType(eventType)) {
    throw new Error(`${label}.eventType is invalid`);
  }
  if (!isAccessObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordPositiveInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }

  return {
    version: 1,
    eventId: readRecordString(record, "eventId", label),
    eventType,
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    organizationId: readRecordString(record, "organizationId", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    dependencyManifestHashes: readStringArray(
      readRecordValue(record, "dependencyManifestHashes", label),
      `${label}.dependencyManifestHashes`,
    ),
    bodyHash: readRecordString(record, "bodyHash", label),
    signerUserId: readRecordString(record, "signerUserId", label),
    signerDeviceId: readRecordString(record, "signerDeviceId", label),
    signerKeyFingerprint: readRecordString(
      record,
      "signerKeyFingerprint",
      label,
    ),
    signedAt: readRecordString(record, "signedAt", label),
    signature: readRecordString(record, "signature", label),
  };
}

function readAccessManifest(value: unknown, label: string): AccessManifest {
  const record = readCanonicalRecord(value, label);
  const objectKind = readRecordValue(record, "objectKind", label);
  if (!isAccessObjectKind(objectKind)) {
    throw new Error(`${label}.objectKind is invalid`);
  }
  if (readRecordPositiveInteger(record, "version", label) !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  const referencedPrincipalHeads = readRecordValue(
    record,
    "referencedPrincipalHeads",
    label,
  );
  if (!Array.isArray(referencedPrincipalHeads)) {
    throw new Error(`${label}.referencedPrincipalHeads must be an array`);
  }

  return {
    version: 1,
    objectKind,
    objectId: readRecordString(record, "objectId", label),
    organizationId: readRecordString(record, "organizationId", label),
    epoch: readRecordPositiveInteger(record, "epoch", label),
    previousManifestHash: readRecordNullableString(
      record,
      "previousManifestHash",
      label,
    ),
    eventHash: readRecordString(record, "eventHash", label),
    structuralHash: readRecordString(record, "structuralHash", label),
    grantRoot: readRecordString(record, "grantRoot", label),
    referencedPrincipalHeads: referencedPrincipalHeads.map((head, index) => {
      const headRecord = readCanonicalRecord(
        head,
        `${label}.referencedPrincipalHeads[${index}]`,
      );
      const principalType = readRecordValue(
        headRecord,
        "principalType",
        `${label}.referencedPrincipalHeads[${index}]`,
      );
      if (principalType !== "group" && principalType !== "organization") {
        throw new Error(
          `${label}.referencedPrincipalHeads[${index}].principalType is invalid`,
        );
      }
      return {
        principalType,
        principalId: readRecordString(
          headRecord,
          "principalId",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        version: readRecordPositiveInteger(
          headRecord,
          "version",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        keyEpoch: readRecordPositiveInteger(
          headRecord,
          "keyEpoch",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        stateHash: readRecordString(
          headRecord,
          "stateHash",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
        keyFingerprint: readRecordString(
          headRecord,
          "keyFingerprint",
          `${label}.referencedPrincipalHeads[${index}]`,
        ),
      };
    }),
    keyTargetHash: readRecordString(record, "keyTargetHash", label),
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
  const recipientKind = readRecordValue(record, "recipientKind", label);
  if (!isRecipientKind(recipientKind)) {
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

function readContainerKekRecipientTarget(
  value: unknown,
  label: string,
): ContainerKekRecipientTarget {
  const record = readCanonicalRecord(value, label);
  const recipientKind = readRecordValue(record, "recipientKind", label);
  if (!isRecipientKind(recipientKind)) {
    throw new Error(`${label}.recipientKind is invalid`);
  }

  return {
    recipientKind,
    recipientId: readRecordString(record, "recipientId", label),
    recipientKeyEpochId: readRecordString(record, "recipientKeyEpochId", label),
    recipientKeyFingerprint: readRecordString(
      record,
      "recipientKeyFingerprint",
      label,
    ),
  };
}

function readDocumentAccessEventBody(
  value: unknown,
  label: string,
): DocumentLinkAccessEventBody | DocumentUnlinkAccessEventBody {
  const record = readCanonicalRecord(value, label);
  const eventType = readRecordValue(record, "eventType", label);
  if (eventType !== "document.link" && eventType !== "document.unlink") {
    throw new Error(`${label}.eventType is invalid`);
  }

  return {
    eventType,
    containerId: readRecordString(record, "containerId", label),
    containerManifestHash: readRecordString(
      record,
      "containerManifestHash",
      label,
    ),
  };
}

function canonicalString(value: unknown, label: string): string {
  return serializeKeyingCanonicalJson(readCanonicalJson(value, label));
}

function assertCanonicalEqual(input: {
  readonly actual: unknown;
  readonly expected: unknown;
  readonly label: string;
}): void {
  if (
    canonicalString(input.actual, `${input.label} actual`) !==
    canonicalString(input.expected, `${input.label} expected`)
  ) {
    throw new Error(`${input.label} mismatch`);
  }
}

function addBundleByHash(
  bundlesByHash: Map<string, AccessManifestBundleWireResponse>,
  bundle: AccessManifestBundleWireResponse,
  label: string,
): void {
  const existing = bundlesByHash.get(bundle.manifestHash);
  if (!existing) {
    bundlesByHash.set(bundle.manifestHash, bundle);
    return;
  }

  if (
    canonicalString(existing, `${label} existing`) !==
    canonicalString(bundle, `${label} duplicate`)
  ) {
    throw new Error(
      `Writer projection has equivocal manifest bundle ${bundle.manifestHash}`,
    );
  }
}

async function verifyAccessEventBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly label: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}) {
  const eventBundle = readCanonicalRecord(
    input.bundle.event,
    `${input.label} event bundle`,
  );
  const eventHash = readRecordString(
    eventBundle,
    "eventHash",
    `${input.label} event bundle`,
  );
  const event = readAccessEvent(
    readRecordValue(eventBundle, "event", `${input.label} event bundle`),
    `${input.label} signed event`,
  );
  const body = readCanonicalJson(
    readRecordValue(eventBundle, "body", `${input.label} event bundle`),
    `${input.label} event body`,
  );
  const userKey = await input.resolveUserKey(event.signerUserId);
  if (!userKey) {
    throw new Error(
      `${input.label} signer public key could not be resolved for ${event.signerUserId}`,
    );
  }

  const verified = await verifySignedAccessEvent({
    body,
    event,
    signerPublicKey: userKey.signingPublicKey,
  });
  if (!verified.ok) {
    throw new Error(`${input.label} signature verification failed`);
  }
  if (verified.value.eventHash !== eventHash) {
    throw new Error(`${input.label} event hash mismatch`);
  }

  return verified.value;
}

async function verifyContainerManifestBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
}): Promise<VerifiedContainerAccessManifest> {
  const cached = input.verifiedByHash.get(input.bundle.manifestHash);
  if (cached) {
    return cached;
  }

  const event = await verifyAccessEventBundle(input);
  const manifest = readAccessManifest(
    input.bundle.manifest,
    `${input.label} manifest`,
  );
  const previousManifest =
    event.event.previousManifestHash === null
      ? null
      : await verifyPreviousContainerManifest({
          ...input,
          previousManifestHash: event.event.previousManifestHash,
        });

  const verified = await verifyContainerAccessManifest({
    destinationParentContainerPath: input.parentPath,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    parentContainerPath: input.parentPath,
    principalPolicies: [],
    ...(previousManifest
      ? {
          previousContainerPath: [...input.parentPath, previousManifest],
          previousManifest,
        }
      : { previousManifest: null }),
  });
  if (!verified.ok) {
    throw new Error(`${input.label} manifest verification failed`);
  }

  assertCanonicalEqual({
    actual: input.bundle.state,
    expected: verified.value.state as unknown as KeyingCanonicalJson,
    label: `${input.label} state`,
  });
  input.verifiedByHash.set(input.bundle.manifestHash, verified.value);

  return verified.value;
}

async function verifyPreviousContainerManifest(input: {
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly previousManifestHash: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
}): Promise<VerifiedContainerAccessManifest> {
  const previousBundle = input.bundlesByHash.get(input.previousManifestHash);
  if (!previousBundle) {
    throw new Error(
      `${input.label} previous manifest ${input.previousManifestHash} is missing`,
    );
  }

  return verifyContainerManifestBundle({
    bundle: previousBundle,
    bundlesByHash: input.bundlesByHash,
    label: `${input.label} previous manifest`,
    parentPath: input.parentPath,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash: input.verifiedByHash,
  });
}

async function collectContainerUserRecipientKeys(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<ContainerUserRecipientKey[]> {
  const userIds = [
    ...new Set(
      input.containerManifest.state.directGrants
        .filter((grant) => grant.subjectType === "user")
        .map((grant) => grant.subjectId),
    ),
  ].sort();
  const userRecipientKeys: ContainerUserRecipientKey[] = [];

  for (const userId of userIds) {
    const userKey = await input.resolveUserKey(userId);
    if (!userKey) {
      throw new Error(
        `Container writer projection recipient key could not be resolved for ${userId}`,
      );
    }
    const recipientKeyFingerprint = await toFingerprint(
      userKey.encapsulationPublicKey,
    );
    userRecipientKeys.push({
      userId,
      recipientKeyEpochId: `user:${userId}:encapsulation:${recipientKeyFingerprint}`,
      recipientKeyFingerprint,
    });
  }

  return userRecipientKeys;
}

function hasManagedPrincipalGrants(
  containerManifest: VerifiedContainerAccessManifest,
): boolean {
  return containerManifest.state.directGrants.some(
    (grant) => grant.subjectType !== "user",
  );
}

async function verifyContainerKekProjection(input: {
  readonly kek: ContainerWriterProjectionResponse["containerKeks"][number];
  readonly label: string;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedManifest: VerifiedContainerAccessManifest;
  readonly verifiedManifestHistory: readonly VerifiedContainerAccessManifest[];
}): Promise<VerifiedContainerKekState> {
  if (hasManagedPrincipalGrants(input.verifiedManifest)) {
    throw new Error(
      `${input.label} contains managed principal grants, which require principal policy verification`,
    );
  }
  if (input.verifiedManifest.state.parentContainerId && !input.parentKekState) {
    throw new Error(`${input.label} requires verified parent KEK state`);
  }

  const keyEpoch = readContainerKeyEpoch(
    input.kek.keyEpoch,
    `${input.label} key epoch`,
  );
  const wraps = input.kek.wraps.map((wrap, index) =>
    readContainerKeyWrap(wrap, `${input.label} wrap[${index}]`),
  );
  const userRecipientKeys = await collectContainerUserRecipientKeys({
    containerManifest: input.verifiedManifest,
    resolveUserKey: input.resolveUserKey,
  });
  const verified = await verifyContainerKekState({
    containerManifest: input.verifiedManifest,
    containerManifestHistory: input.verifiedManifestHistory,
    keyEpoch,
    parentKekState: input.parentKekState,
    principalPolicies: [],
    userRecipientKeys,
    wraps,
  });
  if (!verified.ok) {
    throw new Error(`${input.label} KEK verification failed`);
  }

  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  if (keyEpochHash !== input.kek.keyEpochHash) {
    throw new Error(`${input.label} key epoch hash mismatch`);
  }
  const recipientTargets = input.kek.recipientTargets.map((target, index) =>
    readContainerKekRecipientTarget(
      target,
      `${input.label} recipient target[${index}]`,
    ),
  );
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  if (
    keyTargetHash !== input.kek.keyTargetHash ||
    keyTargetHash !== verified.value.keyTargetHash
  ) {
    throw new Error(`${input.label} target hash mismatch`);
  }
  if (
    verified.value.containerKeyEpochId !== input.kek.containerKeyEpochId ||
    verified.value.containerKeyEpoch !== input.kek.containerKeyEpoch ||
    verified.value.accessManifestHash !== input.kek.accessManifestHash ||
    verified.value.parentContainerKeyEpochId !==
      input.kek.parentContainerKeyEpochId
  ) {
    throw new Error(`${input.label} identity mismatch`);
  }

  return verified.value;
}

async function verifyContainerManifestPath(input: {
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly label: string;
  readonly path: readonly AccessManifestBundleWireResponse[];
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
}): Promise<VerifiedContainerAccessManifest[]> {
  const verifiedPath: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of input.path.entries()) {
    verifiedPath.push(
      await verifyContainerManifestBundle({
        bundle,
        bundlesByHash: input.bundlesByHash,
        label: `${input.label}[${index}]`,
        parentPath: verifiedPath,
        resolveUserKey: input.resolveUserKey,
        verifiedByHash: input.verifiedByHash,
      }),
    );
  }

  return verifiedPath;
}

export async function verifyContainerWriterProjection(input: {
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedContainerAccessManifest[]> {
  if (input.projection.path.length !== input.projection.containerKeks.length) {
    throw new Error(
      "Container writer projection path and KEKs are inconsistent",
    );
  }

  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  for (const [index, bundle] of input.projection.path.entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Container writer projection path[${index}]`,
    );
  }
  for (const [kekIndex, kek] of input.projection.containerKeks.entries()) {
    for (const [historyIndex, bundle] of (
      kek.containerManifestHistory ?? []
    ).entries()) {
      addBundleByHash(
        bundlesByHash,
        bundle,
        `Container writer projection KEK[${kekIndex}] history[${historyIndex}]`,
      );
    }
  }

  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const verifiedPath = await verifyContainerManifestPath({
    bundlesByHash,
    label: "Container writer projection path",
    path: input.projection.path,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
  });

  const verifiedKekStates: VerifiedContainerKekState[] = [];
  for (const [index, kek] of input.projection.containerKeks.entries()) {
    const verifiedManifest = verifiedPath[index];
    if (!verifiedManifest) {
      throw new Error(`Container writer projection KEK[${index}] is missing`);
    }
    const verifiedManifestHistory: VerifiedContainerAccessManifest[] = [];
    for (const [historyIndex, bundle] of (
      kek.containerManifestHistory ?? []
    ).entries()) {
      verifiedManifestHistory.push(
        await verifyContainerManifestBundle({
          bundle,
          bundlesByHash,
          label: `Container writer projection KEK[${index}] history[${historyIndex}]`,
          parentPath: verifiedPath.slice(0, index),
          resolveUserKey: input.resolveUserKey,
          verifiedByHash,
        }),
      );
    }

    const verifiedKekState = await verifyContainerKekProjection({
      kek,
      label: `Container writer projection KEK[${index}]`,
      parentKekState: index > 0 ? (verifiedKekStates[index - 1] ?? null) : null,
      resolveUserKey: input.resolveUserKey,
      verifiedManifest,
      verifiedManifestHistory,
    });
    verifiedKekStates.push(verifiedKekState);
  }

  return verifiedPath;
}

function addContainerWriterProjectionBundles(
  bundlesByHash: Map<string, AccessManifestBundleWireResponse>,
  projection: ContainerWriterProjectionResponse,
  label: string,
): void {
  for (const [index, bundle] of projection.path.entries()) {
    addBundleByHash(bundlesByHash, bundle, `${label} path[${index}]`);
  }
  for (const [kekIndex, kek] of projection.containerKeks.entries()) {
    for (const [historyIndex, bundle] of (
      kek.containerManifestHistory ?? []
    ).entries()) {
      addBundleByHash(
        bundlesByHash,
        bundle,
        `${label} KEK[${kekIndex}] history[${historyIndex}]`,
      );
    }
  }
}

function readDocumentProjectionContainerPaths(
  projection: DocumentWriterProjectionResponse,
): AccessManifestBundleWireResponse[][] {
  return [
    ...(projection.documentManifestContainerPaths ?? []),
    ...projection.authorizingContainerPaths.map((path) => path.path),
  ];
}

async function verifyProjectionContainerPaths(input: {
  readonly projection: DocumentWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<Map<string, VerifiedContainerAccessManifest[]>> {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  for (const [
    index,
    projection,
  ] of input.projection.authorizingContainerPaths.entries()) {
    addContainerWriterProjectionBundles(
      bundlesByHash,
      projection,
      `Document writer projection authorizing path[${index}]`,
    );
  }
  for (const [index, path] of readDocumentProjectionContainerPaths(
    input.projection,
  ).entries()) {
    for (const [pathIndex, bundle] of path.entries()) {
      addBundleByHash(
        bundlesByHash,
        bundle,
        `Document writer projection dependency path[${index}][${pathIndex}]`,
      );
    }
  }
  for (const [index, bundle] of (
    input.projection.documentContainerManifestHistory ?? []
  ).entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Document writer projection container history[${index}]`,
    );
  }

  const containerPathByManifestHash = new Map<
    string,
    VerifiedContainerAccessManifest[]
  >();
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  for (const projection of input.projection.authorizingContainerPaths) {
    const path = await verifyContainerWriterProjection({
      projection,
      resolveUserKey: input.resolveUserKey,
    });
    const leaf = path.at(-1);
    if (leaf) {
      containerPathByManifestHash.set(leaf.manifestHash, path);
    }
    for (const manifest of path) {
      verifiedByHash.set(manifest.manifestHash, manifest);
    }
  }
  for (const [index, path] of readDocumentProjectionContainerPaths(
    input.projection,
  ).entries()) {
    const verifiedPath = await verifyContainerManifestPath({
      bundlesByHash,
      label: `Document writer projection dependency path[${index}]`,
      path,
      resolveUserKey: input.resolveUserKey,
      verifiedByHash,
    });
    const leaf = verifiedPath.at(-1);
    if (leaf) {
      containerPathByManifestHash.set(leaf.manifestHash, verifiedPath);
    }
  }

  return containerPathByManifestHash;
}

async function verifyPreviousDocumentManifest(input: {
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly label: string;
  readonly previousManifestHash: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedDocumentLinkSetManifest>;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const previousBundle = input.bundlesByHash.get(input.previousManifestHash);
  if (!previousBundle) {
    throw new Error(
      `${input.label} previous manifest ${input.previousManifestHash} is missing`,
    );
  }

  return verifyDocumentManifestBundle({
    ...input,
    bundle: previousBundle,
  });
}

async function verifyDocumentManifestBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly label: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedDocumentLinkSetManifest>;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const cached = input.verifiedByHash.get(input.bundle.manifestHash);
  if (cached) {
    return cached;
  }

  const event = await verifyAccessEventBundle(input);
  const manifest = readAccessManifest(
    input.bundle.manifest,
    `${input.label} manifest`,
  );
  const previousManifest =
    event.event.previousManifestHash === null
      ? null
      : await verifyPreviousDocumentManifest({
          ...input,
          previousManifestHash: event.event.previousManifestHash,
        });
  const body = readDocumentAccessEventBody(
    event.body,
    `${input.label} event body`,
  );
  const dependencyContainerPaths = event.event.dependencyManifestHashes
    .map((manifestHash) => input.containerPathByManifestHash.get(manifestHash))
    .filter(
      (path): path is readonly VerifiedContainerAccessManifest[] =>
        path !== undefined,
    )
    .map((path) => [...path]);

  const targetContainerPath = input.containerPathByManifestHash.get(
    body.containerManifestHash,
  );
  const verified = await verifyDocumentLinkSetManifest({
    authorizingContainerPaths: dependencyContainerPaths,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    previousManifest,
    principalPolicies: [],
    ...(targetContainerPath ? { targetContainerPath } : {}),
  });
  if (!verified.ok) {
    throw new Error(`${input.label} manifest verification failed`);
  }

  assertCanonicalEqual({
    actual: input.bundle.state,
    expected: verified.value.state as unknown as KeyingCanonicalJson,
    label: `${input.label} state`,
  });
  input.verifiedByHash.set(input.bundle.manifestHash, verified.value);

  return verified.value;
}

export async function verifyDocumentWriterProjection(input: {
  readonly projection: DocumentWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const containerPathByManifestHash =
    await verifyProjectionContainerPaths(input);
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  addBundleByHash(
    bundlesByHash,
    input.projection.documentManifest,
    "Document writer projection manifest",
  );
  for (const [index, bundle] of (
    input.projection.documentManifestHistory ?? []
  ).entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Document writer projection manifest history[${index}]`,
    );
  }

  return verifyDocumentManifestBundle({
    bundle: input.projection.documentManifest,
    bundlesByHash,
    containerPathByManifestHash,
    label: "Document writer projection",
    resolveUserKey: input.resolveUserKey,
    verifiedByHash: new Map<string, VerifiedDocumentLinkSetManifest>(),
  });
}
