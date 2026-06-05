import {
  type ContainerUserRecipientKey,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  type VerifiedContainerKekState,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedPrincipalPolicy,
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
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { readCanonicalJson, readCanonicalRecord } from "./keyingCanonicalJson";
import {
  readAccessEvent,
  readAccessManifest,
  readContainerKekRecipientTarget,
  readContainerKeyEpoch,
  readContainerKeyWrap,
  readDocumentAccessEventBody,
  readRecordNullableString,
  readRecordString,
  readRecordValue,
} from "./keyingProjectionVerification/readers";
import { loadPrincipalPolicyBundle } from "./persistence/principalPolicyPersistence";
import {
  verifyOrganizationAdminSignerUserIds,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "./principalPolicyAdminSigners";
import type { ExecSql } from "./sqlite/sqlSchema";

export interface ProjectionUserKey {
  readonly encapsulationPublicKey: Uint8Array;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}

export type ProjectionUserKeyResolver = (
  userId: string,
) => Promise<ProjectionUserKey | null>;

export function requireProjectionUserKeyResolver(
  resolveProjectionUserKey: ProjectionUserKeyResolver | null | undefined,
  label: string,
): ProjectionUserKeyResolver {
  if (!resolveProjectionUserKey) {
    throw new Error(`${label} requires projection key verification`);
  }

  return resolveProjectionUserKey;
}

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
  let ownUserKey: Promise<ProjectionUserKey | null> | null = null;
  let ownUserKeyUserId: string | null = null;
  let ownUserKeySigningFingerprint: string | null | undefined;
  let ownUserKeySigningKeyPair: ProjectionUserKeyRuntime["signingKeyPair"];
  let ownUserKeyEncapsulationKeyPair: ProjectionUserKeyRuntime["encapsulationKeyPair"];

  return async (userId) => {
    if (
      userId === runtime.userId &&
      runtime.signingKeyPair &&
      runtime.encapsulationKeyPair
    ) {
      if (
        !ownUserKey ||
        ownUserKeyUserId !== userId ||
        ownUserKeySigningFingerprint !== runtime.signingFingerprint ||
        ownUserKeySigningKeyPair !== runtime.signingKeyPair ||
        ownUserKeyEncapsulationKeyPair !== runtime.encapsulationKeyPair
      ) {
        const { encapsulationKeyPair, signingKeyPair } = runtime;
        ownUserKey = null;
        ownUserKeyUserId = userId;
        ownUserKeySigningFingerprint = runtime.signingFingerprint;
        ownUserKeySigningKeyPair = signingKeyPair;
        ownUserKeyEncapsulationKeyPair = encapsulationKeyPair;
        ownUserKey = (async () => {
          const signingFingerprint = await toFingerprint(
            signingKeyPair.signingPublicKey,
          );
          if (
            runtime.signingFingerprint &&
            runtime.signingFingerprint !== signingFingerprint
          ) {
            return null;
          }

          return {
            encapsulationPublicKey: encapsulationKeyPair.publicKey,
            signingPublicKey: signingKeyPair.signingPublicKey,
            userId,
          };
        })();
      }

      return ownUserKey;
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

export type PrincipalPolicyCache = Map<string, VerifiedPrincipalPolicy>;

function referencedPrincipalPolicyKey(
  reference: ReferencedPrincipalHead,
): string {
  return `${reference.principalType}:${reference.principalId}:${reference.version}:${reference.stateHash}`;
}

function principalPolicyReferenceLabel(
  reference: ReferencedPrincipalHead,
): string {
  return `${reference.principalType}:${reference.principalId}@${reference.version}`;
}

function principalPolicyBundleStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

async function collectPrincipalPolicySignerPublicKeys(input: {
  bundle: PrincipalPolicyBundleResponse;
  label: string;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<PrincipalPolicySignerPublicKey[]> {
  const signerPublicKeysByKey = new Map<
    string,
    PrincipalPolicySignerPublicKey
  >();

  for (const state of principalPolicyBundleStates(input.bundle)) {
    const cacheKey = `${state.signerUserId}:${state.signerUserKeyFingerprint}`;
    if (signerPublicKeysByKey.has(cacheKey)) {
      continue;
    }

    const signerKey = await input.resolveUserKey(state.signerUserId);
    if (!signerKey) {
      throw new Error(
        `${input.label} signer key could not be resolved for ${state.signerUserId}`,
      );
    }

    const signingKeyFingerprint = await toFingerprint(
      signerKey.signingPublicKey,
    );
    if (signingKeyFingerprint !== state.signerUserKeyFingerprint) {
      throw new Error(`${input.label} signer key fingerprint mismatch`);
    }

    signerPublicKeysByKey.set(cacheKey, {
      userId: state.signerUserId,
      signingKeyFingerprint,
      signingPublicKey: signerKey.signingPublicKey,
    });
  }

  return [...signerPublicKeysByKey.values()];
}

async function loadOrganizationExternalAdminSignerUserIds(input: {
  execSql?: ExecSql | undefined;
  organizationId: string;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<string[]> {
  if (!input.execSql) {
    return [];
  }

  const bundle = await loadPrincipalPolicyBundle(
    input.execSql,
    "organization",
    input.organizationId,
  );
  if (!bundle) {
    return [];
  }

  try {
    const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
      bundle,
      label: `Organization policy ${input.organizationId}`,
      resolveUserKey: input.resolveUserKey,
    });

    return verifyOrganizationAdminSignerUserIds({
      bundle,
      organizationId: input.organizationId,
      signerPublicKeys,
    });
  } catch {
    return [];
  }
}

async function verifyReferencedPrincipalPolicy(input: {
  execSql?: ExecSql | undefined;
  organizationId: string;
  principalPolicyCache: PrincipalPolicyCache;
  reference: ReferencedPrincipalHead;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedPrincipalPolicy> {
  const cacheKey = referencedPrincipalPolicyKey(input.reference);
  const cachedPolicy = input.principalPolicyCache.get(cacheKey);
  if (cachedPolicy) {
    return cachedPolicy;
  }

  const referenceLabel = principalPolicyReferenceLabel(input.reference);
  if (!input.execSql) {
    throw new Error(
      `Principal policy ${referenceLabel} requires a verified local cache`,
    );
  }

  const bundle = await loadPrincipalPolicyBundle(
    input.execSql,
    input.reference.principalType,
    input.reference.principalId,
  );
  if (!bundle) {
    throw new Error(`Principal policy ${referenceLabel} is not cached`);
  }

  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    label: `Principal policy ${referenceLabel}`,
    resolveUserKey: input.resolveUserKey,
  });
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: input.reference,
      loadExternalAdminSignerUserIds: () =>
        loadOrganizationExternalAdminSignerUserIds({
          execSql: input.execSql,
          organizationId: input.organizationId,
          resolveUserKey: input.resolveUserKey,
        }),
      localCheckpoint: null,
      signerPublicKeys,
    });
  if (!verified.ok) {
    throw new Error(
      `Principal policy ${referenceLabel} verification failed: ${verified.error.message}`,
    );
  }

  input.principalPolicyCache.set(cacheKey, verified.value);
  return verified.value;
}

async function collectReferencedPrincipalPolicies(input: {
  execSql?: ExecSql | undefined;
  organizationId: string;
  principalPolicyCache: PrincipalPolicyCache;
  references: readonly ReferencedPrincipalHead[];
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedPrincipalPolicy[]> {
  const uniqueReferences = new Map<string, ReferencedPrincipalHead>();
  for (const reference of input.references) {
    uniqueReferences.set(referencedPrincipalPolicyKey(reference), reference);
  }

  return Promise.all(
    [...uniqueReferences.values()].map((reference) =>
      verifyReferencedPrincipalPolicy({
        execSql: input.execSql,
        organizationId: input.organizationId,
        principalPolicyCache: input.principalPolicyCache,
        reference,
        resolveUserKey: input.resolveUserKey,
      }),
    ),
  );
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
  readonly execSql?: ExecSql | undefined;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
}): Promise<VerifiedContainerAccessManifest> {
  const parentPath =
    await resolveContainerManifestVerificationParentPath(input);
  const cached = input.verifiedByHash.get(input.bundle.manifestHash);
  if (cached) {
    assertContainerParentPathMatches({
      label: input.label,
      parentPath,
      verifiedManifest: cached,
    });
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
          parentPath,
          previousManifestHash: event.event.previousManifestHash,
        });
  const referencedPrincipalHeads = [
    ...parentPath.flatMap(
      (parentManifest) => parentManifest.state.referencedPrincipalHeads,
    ),
    ...(previousManifest?.state.referencedPrincipalHeads ?? []),
    ...manifest.referencedPrincipalHeads,
  ];
  const principalPolicies = await collectReferencedPrincipalPolicies({
    execSql: input.execSql,
    organizationId: event.event.organizationId,
    principalPolicyCache: input.principalPolicyCache,
    references: referencedPrincipalHeads,
    resolveUserKey: input.resolveUserKey,
  });

  const verified = await verifyContainerAccessManifest({
    destinationParentContainerPath: parentPath,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    parentContainerPath: parentPath,
    principalPolicies,
    ...(previousManifest
      ? {
          previousContainerPath: [...parentPath, previousManifest],
          previousManifest,
        }
      : { previousManifest: null }),
  });
  if (!verified.ok) {
    throw new Error(`${input.label} manifest verification failed`);
  }

  assertCanonicalEqual({
    actual: input.bundle.state,
    expected: readCanonicalJson(verified.value.state, `${input.label} state`),
    label: `${input.label} state`,
  });
  input.verifiedByHash.set(input.bundle.manifestHash, verified.value);

  return verified.value;
}

function assertContainerParentPathMatches(input: {
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly verifiedManifest: VerifiedContainerAccessManifest;
}): void {
  const actualParentManifestHash =
    input.parentPath.at(-1)?.manifestHash ?? null;
  if (
    actualParentManifestHash !== input.verifiedManifest.state.parentManifestHash
  ) {
    throw new Error(`${input.label} parent path mismatch`);
  }
}

function readContainerManifestParentReference(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): {
  parentContainerId: string | null;
  parentManifestHash: string | null;
} {
  const state = readCanonicalRecord(bundle.state, `${label} state`);

  return {
    parentContainerId: readRecordNullableString(
      state,
      "parentContainerId",
      `${label} state`,
    ),
    parentManifestHash: readRecordNullableString(
      state,
      "parentManifestHash",
      `${label} state`,
    ),
  };
}

async function resolveContainerManifestVerificationParentPath(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly execSql?: ExecSql | undefined;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
}): Promise<readonly VerifiedContainerAccessManifest[]> {
  // Descendants keep the parent manifest hash they were created or moved under;
  // a later parent share/rekey must not require rewriting descendant manifests.
  const { parentContainerId, parentManifestHash } =
    readContainerManifestParentReference(input.bundle, input.label);
  if (parentContainerId === null || parentManifestHash === null) {
    return [];
  }

  const parentPathIndex = input.parentPath.findIndex(
    (manifest) =>
      manifest.state.containerId === parentContainerId &&
      manifest.manifestHash === parentManifestHash,
  );
  if (parentPathIndex >= 0) {
    return input.parentPath.slice(0, parentPathIndex + 1);
  }

  const parentBundle = input.bundlesByHash.get(parentManifestHash);
  if (!parentBundle) {
    return input.parentPath;
  }

  const parentParentPath = await resolveContainerManifestVerificationParentPath(
    {
      ...input,
      bundle: parentBundle,
      label: `${input.label} parent manifest`,
    },
  );
  const verifiedParent = await verifyContainerManifestBundle({
    ...input,
    bundle: parentBundle,
    label: `${input.label} parent manifest`,
    parentPath: parentParentPath,
  });
  if (verifiedParent.state.containerId !== parentContainerId) {
    throw new Error(`${input.label} parent manifest container mismatch`);
  }

  return [...parentParentPath, verifiedParent];
}

async function verifyPreviousContainerManifest(input: {
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly execSql?: ExecSql | undefined;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
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
  const parentPath = await resolveContainerManifestVerificationParentPath({
    ...input,
    bundle: previousBundle,
  });

  return verifyContainerManifestBundle({
    bundle: previousBundle,
    bundlesByHash: input.bundlesByHash,
    execSql: input.execSql,
    label: `${input.label} previous manifest`,
    parentPath,
    principalPolicyCache: input.principalPolicyCache,
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

function containerKekManifestHistory(input: {
  readonly history: readonly VerifiedContainerAccessManifest[];
  readonly verifiedManifest: VerifiedContainerAccessManifest;
}): VerifiedContainerAccessManifest[] {
  const historyByHash = new Map<string, VerifiedContainerAccessManifest>();

  for (const manifest of input.history) {
    if (
      manifest.state.containerId === input.verifiedManifest.state.containerId &&
      manifest.manifestHash !== input.verifiedManifest.manifestHash
    ) {
      historyByHash.set(manifest.manifestHash, manifest);
    }
  }

  return [...historyByHash.values()];
}

async function verifyContainerKekProjection(input: {
  readonly execSql?: ExecSql | undefined;
  readonly kek: ContainerWriterProjectionResponse["containerKeks"][number];
  readonly label: string;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedManifest: VerifiedContainerAccessManifest;
  readonly verifiedManifestHistory: readonly VerifiedContainerAccessManifest[];
}): Promise<VerifiedContainerKekState> {
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
  const verifiedKekManifestHistory = containerKekManifestHistory({
    history: input.verifiedManifestHistory,
    verifiedManifest: input.verifiedManifest,
  });
  const principalPolicies = await collectReferencedPrincipalPolicies({
    execSql: input.execSql,
    organizationId: input.verifiedManifest.state.organizationId,
    principalPolicyCache: input.principalPolicyCache,
    references: [
      ...verifiedKekManifestHistory.flatMap(
        (manifest) => manifest.state.referencedPrincipalHeads,
      ),
      ...input.verifiedManifest.state.referencedPrincipalHeads,
    ],
    resolveUserKey: input.resolveUserKey,
  });
  const verified = await verifyContainerKekState({
    containerManifest: input.verifiedManifest,
    containerManifestHistory: verifiedKekManifestHistory,
    keyEpoch,
    parentKekState: input.parentKekState,
    principalPolicies,
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
  readonly execSql?: ExecSql | undefined;
  readonly label: string;
  readonly path: readonly AccessManifestBundleWireResponse[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
}): Promise<VerifiedContainerAccessManifest[]> {
  const verifiedPath: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of input.path.entries()) {
    verifiedPath.push(
      await verifyContainerManifestBundle({
        bundle,
        bundlesByHash: input.bundlesByHash,
        execSql: input.execSql,
        label: `${input.label}[${index}]`,
        parentPath: verifiedPath,
        principalPolicyCache: input.principalPolicyCache,
        resolveUserKey: input.resolveUserKey,
        verifiedByHash: input.verifiedByHash,
      }),
    );
  }

  return verifiedPath;
}

export async function verifyContainerWriterProjection(input: {
  readonly execSql?: ExecSql | undefined;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash?:
    | Map<string, VerifiedContainerAccessManifest>
    | undefined;
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

  const verifiedByHash =
    input.verifiedByHash ?? new Map<string, VerifiedContainerAccessManifest>();
  const principalPolicyCache =
    input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
  const verifiedPath = await verifyContainerManifestPath({
    bundlesByHash,
    execSql: input.execSql,
    label: "Container writer projection path",
    path: input.projection.path,
    principalPolicyCache,
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
          execSql: input.execSql,
          label: `Container writer projection KEK[${index}] history[${historyIndex}]`,
          parentPath: verifiedPath.slice(0, index),
          principalPolicyCache,
          resolveUserKey: input.resolveUserKey,
          verifiedByHash,
        }),
      );
    }

    const verifiedKekState = await verifyContainerKekProjection({
      execSql: input.execSql,
      kek,
      label: `Container writer projection KEK[${index}]`,
      parentKekState: index > 0 ? (verifiedKekStates[index - 1] ?? null) : null,
      principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      verifiedManifest,
      verifiedManifestHistory,
    });
    verifiedKekStates.push(verifiedKekState);
  }

  return verifiedPath;
}

export async function collectContainerWriterProjectionPrincipalPolicies(input: {
  readonly execSql?: ExecSql | undefined;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedPrincipalPolicy[]> {
  const principalPolicyCache =
    input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
  const verifiedPath = await verifyContainerWriterProjection({
    execSql: input.execSql,
    principalPolicyCache,
    projection: input.projection,
    resolveUserKey: input.resolveUserKey,
  });

  return collectPrincipalPoliciesForContainerPaths({
    execSql: input.execSql,
    organizationId: input.projection.organizationId,
    paths: [verifiedPath],
    principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
  });
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
  readonly execSql?: ExecSql | undefined;
  readonly principalPolicyCache: PrincipalPolicyCache;
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
      execSql: input.execSql,
      principalPolicyCache: input.principalPolicyCache,
      projection,
      resolveUserKey: input.resolveUserKey,
      verifiedByHash,
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
      execSql: input.execSql,
      label: `Document writer projection dependency path[${index}]`,
      path,
      principalPolicyCache: input.principalPolicyCache,
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

function previousDocumentManifestFromCache(input: {
  readonly event: Awaited<ReturnType<typeof verifyAccessEventBundle>>;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedDocumentLinkSetManifest>;
}): VerifiedDocumentLinkSetManifest | null {
  const previousManifestHash = input.event.event.previousManifestHash;
  if (previousManifestHash === null) {
    return null;
  }

  const previousManifest = input.verifiedByHash.get(previousManifestHash);
  if (!previousManifest) {
    throw new Error(
      `${input.label} previous manifest ${previousManifestHash} is missing`,
    );
  }

  return previousManifest;
}

async function collectPrincipalPoliciesForContainerPaths(input: {
  execSql?: ExecSql | undefined;
  organizationId: string;
  paths: readonly (readonly VerifiedContainerAccessManifest[] | undefined)[];
  principalPolicyCache: PrincipalPolicyCache;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedPrincipalPolicy[]> {
  const referencedPrincipalHeads = input.paths.flatMap((path) =>
    (path ?? []).flatMap((manifest) => manifest.state.referencedPrincipalHeads),
  );

  return collectReferencedPrincipalPolicies({
    execSql: input.execSql,
    organizationId: input.organizationId,
    principalPolicyCache: input.principalPolicyCache,
    references: referencedPrincipalHeads,
    resolveUserKey: input.resolveUserKey,
  });
}

async function verifyDocumentManifestBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly execSql?: ExecSql | undefined;
  readonly label: string;
  readonly principalPolicyCache: PrincipalPolicyCache;
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
  const previousManifest = previousDocumentManifestFromCache({
    event,
    label: input.label,
    verifiedByHash: input.verifiedByHash,
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
  const principalPolicies = await collectPrincipalPoliciesForContainerPaths({
    execSql: input.execSql,
    organizationId: event.event.organizationId,
    paths: [...dependencyContainerPaths, targetContainerPath],
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
  });
  const verified = await verifyDocumentLinkSetManifest({
    authorizingContainerPaths: dependencyContainerPaths,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    previousManifest,
    principalPolicies,
    ...(targetContainerPath ? { targetContainerPath } : {}),
  });
  if (!verified.ok) {
    throw new Error(`${input.label} manifest verification failed`);
  }

  assertCanonicalEqual({
    actual: input.bundle.state,
    expected: readCanonicalJson(verified.value.state, `${input.label} state`),
    label: `${input.label} state`,
  });
  input.verifiedByHash.set(input.bundle.manifestHash, verified.value);

  return verified.value;
}

export async function verifyDocumentWriterProjection(input: {
  readonly execSql?: ExecSql | undefined;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly projection: DocumentWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const principalPolicyCache =
    input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
  const containerPathByManifestHash = await verifyProjectionContainerPaths({
    execSql: input.execSql,
    principalPolicyCache,
    projection: input.projection,
    resolveUserKey: input.resolveUserKey,
  });
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  addBundleByHash(
    bundlesByHash,
    input.projection.documentManifest,
    "Document writer projection manifest",
  );
  const history = input.projection.documentManifestHistory ?? [];
  for (const [index, bundle] of history.entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Document writer projection manifest history[${index}]`,
    );
  }

  const verifiedByHash = new Map<string, VerifiedDocumentLinkSetManifest>();
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const bundle = history[index];
    if (!bundle) {
      throw new Error(
        `Document writer projection manifest history[${index}] is missing`,
      );
    }
    await verifyDocumentManifestBundle({
      bundle,
      bundlesByHash,
      containerPathByManifestHash,
      execSql: input.execSql,
      label: `Document writer projection manifest history[${index}]`,
      principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      verifiedByHash,
    });
  }

  return verifyDocumentManifestBundle({
    bundle: input.projection.documentManifest,
    bundlesByHash,
    containerPathByManifestHash,
    execSql: input.execSql,
    label: "Document writer projection",
    principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
  });
}
