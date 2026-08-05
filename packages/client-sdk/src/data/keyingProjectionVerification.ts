import {
  type ContainerUserRecipientKey,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  KeyingVerificationError,
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
import type {
  AccessManifestBundleWireResponse,
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  canonicalKeyingJsonString,
  readCanonicalJson,
  readCanonicalRecord,
} from "./keyingCanonicalJson";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
  observeAccessManifestCheckpoints,
  type ProjectionCheckpointContext,
} from "./keyingProjectionVerification/checkpointContext";
import {
  loadManifestCheckpointVerification,
  verifyCachedManifestCheckpoint,
} from "./keyingProjectionVerification/manifestCheckpointVerification";
import { collectReferencedPrincipalPolicies } from "./keyingProjectionVerification/principalPolicyVerification";
import {
  readAccessEvent,
  readAccessManifest,
  readContainerKekRecipientTarget,
  readContainerKeyEpoch,
  readContainerKeyWrap,
  readDocumentAccessEventBody,
  readRecordNullableString,
  readRecordString,
  readRequiredRecordValue,
} from "./keyingProjectionVerification/readers";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./keyingProjectionVerification/types";
import type { ExecSql } from "./sqlite/sqlSchema";
import { isTrustedUserIdentity } from "./trustedUserIdentity/types";

export type {
  PrincipalPolicyCache,
  ProjectionUserKey,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./keyingProjectionVerification/types";

export function requireProjectionUserKeyResolver(
  resolveProjectionUserKey: ProjectionUserKeyResolver | null | undefined,
  label: string,
): ProjectionUserKeyResolver {
  if (!resolveProjectionUserKey) {
    throw new Error(`${label} requires projection key verification`);
  }

  return async (userId) => {
    const userKey = await resolveProjectionUserKey(userId);
    if (!userKey) {
      return null;
    }
    if (!isTrustedUserIdentity(userKey)) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `${label} received an untrusted projection identity`,
      );
    }
    if (userKey.userId !== userId) {
      throw new KeyingVerificationError(
        "object_mismatch",
        `${label} received a projection identity for another user`,
      );
    }
    return userKey;
  };
}

function assertCanonicalEqual(input: {
  readonly actual: unknown;
  readonly expected: unknown;
  readonly label: string;
}): void {
  if (
    canonicalKeyingJsonString(input.actual, `${input.label} actual`) !==
    canonicalKeyingJsonString(input.expected, `${input.label} expected`)
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
    canonicalKeyingJsonString(existing, `${label} existing`) !==
    canonicalKeyingJsonString(bundle, `${label} duplicate`)
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
    readRequiredRecordValue(
      eventBundle,
      "event",
      `${input.label} event bundle`,
    ),
    `${input.label} signed event`,
  );
  const body = readCanonicalJson(
    readRequiredRecordValue(eventBundle, "body", `${input.label} event bundle`),
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
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly enforceLocalCheckpoint: boolean;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
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
    if (input.enforceLocalCheckpoint) {
      await verifyCachedManifestCheckpoint({
        current: cached,
        execSql: input.checkpointContext.execSql,
        verifiedManifests: input.verifiedByHash,
      });
    }
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
    checkpointContext: input.checkpointContext,
    organizationId: event.event.organizationId,
    principalPolicyCache: input.principalPolicyCache,
    references: referencedPrincipalHeads,
    resolveUserKey: input.resolveUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const checkpointVerification = input.enforceLocalCheckpoint
    ? await loadManifestCheckpointVerification({
        current: manifest,
        execSql: input.checkpointContext.execSql,
        verifiedManifests: input.verifiedByHash,
      })
    : null;

  const verified = await verifyContainerAccessManifest({
    destinationParentContainerPath: parentPath,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    parentContainerPath: parentPath,
    principalPolicies,
    ...(checkpointVerification ?? {}),
    ...(previousManifest
      ? {
          previousContainerPath: [...parentPath, previousManifest],
          previousManifest,
        }
      : { previousManifest: null }),
  });
  if (!verified.ok) {
    throw new KeyingVerificationError(
      verified.error.code,
      `${input.label} manifest verification failed: ${verified.error.message}`,
    );
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
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
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
    enforceLocalCheckpoint: false,
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
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly previousManifestHash: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
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
    checkpointContext: input.checkpointContext,
    enforceLocalCheckpoint: false,
    label: `${input.label} previous manifest`,
    parentPath,
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash: input.verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
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
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly kek: ContainerWriterProjectionResponse["containerKeks"][number];
  readonly label: string;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedManifest: VerifiedContainerAccessManifest;
  readonly verifiedManifestHistory: readonly VerifiedContainerAccessManifest[];
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
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
    checkpointContext: input.checkpointContext,
    organizationId: input.verifiedManifest.state.organizationId,
    principalPolicyCache: input.principalPolicyCache,
    references: [
      ...verifiedKekManifestHistory.flatMap(
        (manifest) => manifest.state.referencedPrincipalHeads,
      ),
      ...input.verifiedManifest.state.referencedPrincipalHeads,
    ],
    resolveUserKey: input.resolveUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
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
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly enforceLocalCheckpoints: boolean;
  readonly label: string;
  readonly path: readonly AccessManifestBundleWireResponse[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedContainerAccessManifest[]> {
  const verifiedPath: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of input.path.entries()) {
    verifiedPath.push(
      await verifyContainerManifestBundle({
        bundle,
        bundlesByHash: input.bundlesByHash,
        checkpointContext: input.checkpointContext,
        enforceLocalCheckpoint: input.enforceLocalCheckpoints,
        label: `${input.label}[${index}]`,
        parentPath: verifiedPath,
        principalPolicyCache: input.principalPolicyCache,
        resolveUserKey: input.resolveUserKey,
        verifiedByHash: input.verifiedByHash,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      }),
    );
  }

  return verifiedPath;
}

interface ContainerWriterProjectionVerificationInput {
  readonly execSql: ExecSql;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash?:
    | Map<string, VerifiedContainerAccessManifest>
    | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

function verifiedContainerManifestsForBundles(
  bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>,
  verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>,
): VerifiedContainerAccessManifest[] {
  return [...bundlesByHash.keys()].flatMap((manifestHash) => {
    const verified = verifiedByHash.get(manifestHash);
    return verified ? [verified] : [];
  });
}

function collectContainerProjectionBundles(
  projection: ContainerWriterProjectionResponse,
): Map<string, AccessManifestBundleWireResponse> {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  for (const [index, bundle] of projection.path.entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Container writer projection path[${index}]`,
    );
  }
  for (const [kekIndex, kek] of projection.containerKeks.entries()) {
    for (const [
      historyIndex,
      bundle,
    ] of kek.containerManifestHistory.entries()) {
      addBundleByHash(
        bundlesByHash,
        bundle,
        `Container writer projection KEK[${kekIndex}] history[${historyIndex}]`,
      );
    }
  }
  return bundlesByHash;
}

async function verifyContainerWriterProjectionWithContext(
  input: Omit<ContainerWriterProjectionVerificationInput, "execSql">,
  checkpointContext: ProjectionCheckpointContext,
): Promise<VerifiedContainerAccessManifest[]> {
  if (input.projection.path.length !== input.projection.containerKeks.length) {
    throw new Error(
      "Container writer projection path and KEKs are inconsistent",
    );
  }

  const bundlesByHash = collectContainerProjectionBundles(input.projection);

  const verifiedByHash =
    input.verifiedByHash ?? new Map<string, VerifiedContainerAccessManifest>();
  const principalPolicyCache =
    input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
  const verifiedPath = await verifyContainerManifestPath({
    bundlesByHash,
    checkpointContext,
    enforceLocalCheckpoints: true,
    label: "Container writer projection path",
    path: input.projection.path,
    principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });

  const verifiedKekStates: VerifiedContainerKekState[] = [];
  for (const [index, kek] of input.projection.containerKeks.entries()) {
    const verifiedManifest = verifiedPath[index];
    if (!verifiedManifest) {
      throw new Error(`Container writer projection KEK[${index}] is missing`);
    }
    const verifiedManifestHistory: VerifiedContainerAccessManifest[] = [];
    for (const [
      historyIndex,
      bundle,
    ] of kek.containerManifestHistory.entries()) {
      verifiedManifestHistory.push(
        await verifyContainerManifestBundle({
          bundle,
          bundlesByHash,
          checkpointContext,
          enforceLocalCheckpoint: false,
          label: `Container writer projection KEK[${index}] history[${historyIndex}]`,
          parentPath: verifiedPath.slice(0, index),
          principalPolicyCache,
          resolveUserKey: input.resolveUserKey,
          verifiedByHash,
          warmReferencedPrincipalPolicies:
            input.warmReferencedPrincipalPolicies,
        }),
      );
    }

    const verifiedKekState = await verifyContainerKekProjection({
      checkpointContext,
      kek,
      label: `Container writer projection KEK[${index}]`,
      parentKekState: index > 0 ? (verifiedKekStates[index - 1] ?? null) : null,
      principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      verifiedManifest,
      verifiedManifestHistory,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    verifiedKekStates.push(verifiedKekState);
  }

  observeAccessManifestCheckpoints(checkpointContext, {
    verifiedHeads: verifiedPath,
    verifiedManifests: verifiedContainerManifestsForBundles(
      bundlesByHash,
      verifiedByHash,
    ),
  });

  return verifiedPath;
}

export async function verifyContainerWriterProjection(
  input: ContainerWriterProjectionVerificationInput,
): Promise<VerifiedContainerAccessManifest[]> {
  const checkpointContext = createProjectionCheckpointContext({
    execSql: input.execSql,
  });
  const verifiedPath = await verifyContainerWriterProjectionWithContext(
    input,
    checkpointContext,
  );
  await commitProjectionCheckpoints(checkpointContext);
  return verifiedPath;
}

export async function collectContainerWriterProjectionPrincipalPolicies(input: {
  readonly execSql: ExecSql;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const principalPolicyCache =
    input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
  const checkpointContext = createProjectionCheckpointContext({
    execSql: input.execSql,
  });
  const verifiedPath = await verifyContainerWriterProjectionWithContext(
    {
      principalPolicyCache,
      projection: input.projection,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    },
    checkpointContext,
  );

  const policies = await collectPrincipalPoliciesForContainerPaths({
    checkpointContext,
    organizationId: input.projection.organizationId,
    paths: [verifiedPath],
    principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  await commitProjectionCheckpoints(checkpointContext);
  return policies;
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
    for (const [
      historyIndex,
      bundle,
    ] of kek.containerManifestHistory.entries()) {
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
    ...projection.documentManifestContainerPaths,
    ...projection.authorizingContainerPaths.map((path) => path.path),
  ];
}

async function verifyProjectionContainerPaths(input: {
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly projection: DocumentWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash?:
    | Map<string, VerifiedContainerAccessManifest>
    | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
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
  for (const [
    index,
    bundle,
  ] of input.projection.documentContainerManifestHistory.entries()) {
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
  // Reuse a caller-supplied cache when provided so a later unwrap pass over the
  // same authorizing container paths does not re-verify identical manifests.
  const verifiedByHash =
    input.verifiedByHash ?? new Map<string, VerifiedContainerAccessManifest>();
  for (const projection of input.projection.authorizingContainerPaths) {
    const path = await verifyContainerWriterProjectionWithContext(
      {
        principalPolicyCache: input.principalPolicyCache,
        projection,
        resolveUserKey: input.resolveUserKey,
        verifiedByHash,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      },
      input.checkpointContext,
    );
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
      checkpointContext: input.checkpointContext,
      enforceLocalCheckpoints: false,
      label: `Document writer projection dependency path[${index}]`,
      path,
      principalPolicyCache: input.principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    const leaf = verifiedPath.at(-1);
    if (leaf) {
      containerPathByManifestHash.set(leaf.manifestHash, verifiedPath);
    }
  }

  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: [],
    verifiedManifests: verifiedContainerManifestsForBundles(
      bundlesByHash,
      verifiedByHash,
    ),
  });

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
  checkpointContext: ProjectionCheckpointContext;
  organizationId: string;
  paths: readonly (readonly VerifiedContainerAccessManifest[] | undefined)[];
  principalPolicyCache: PrincipalPolicyCache;
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const referencedPrincipalHeads = input.paths.flatMap((path) =>
    (path ?? []).flatMap((manifest) => manifest.state.referencedPrincipalHeads),
  );

  return collectReferencedPrincipalPolicies({
    checkpointContext: input.checkpointContext,
    organizationId: input.organizationId,
    principalPolicyCache: input.principalPolicyCache,
    references: referencedPrincipalHeads,
    resolveUserKey: input.resolveUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}

async function verifyDocumentManifestBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly enforceLocalCheckpoint: boolean;
  readonly label: string;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedDocumentLinkSetManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const cached = input.verifiedByHash.get(input.bundle.manifestHash);
  if (cached) {
    if (input.enforceLocalCheckpoint) {
      await verifyCachedManifestCheckpoint({
        current: cached,
        execSql: input.checkpointContext.execSql,
        verifiedManifests: input.verifiedByHash,
      });
    }
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
    checkpointContext: input.checkpointContext,
    organizationId: event.event.organizationId,
    paths: [...dependencyContainerPaths, targetContainerPath],
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const checkpointVerification = input.enforceLocalCheckpoint
    ? await loadManifestCheckpointVerification({
        current: manifest,
        execSql: input.checkpointContext.execSql,
        verifiedManifests: input.verifiedByHash,
      })
    : null;
  const verified = await verifyDocumentLinkSetManifest({
    authorizingContainerPaths: dependencyContainerPaths,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    previousManifest,
    principalPolicies,
    ...(checkpointVerification ?? {}),
    ...(targetContainerPath ? { targetContainerPath } : {}),
  });
  if (!verified.ok) {
    throw new KeyingVerificationError(
      verified.error.code,
      `${input.label} manifest verification failed: ${verified.error.message}`,
    );
  }

  assertCanonicalEqual({
    actual: input.bundle.state,
    expected: readCanonicalJson(verified.value.state, `${input.label} state`),
    label: `${input.label} state`,
  });
  input.verifiedByHash.set(input.bundle.manifestHash, verified.value);

  return verified.value;
}

interface DocumentWriterProjectionVerificationInput {
  readonly execSql: ExecSql;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly projection: DocumentWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash?:
    | Map<string, VerifiedContainerAccessManifest>
    | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

async function verifyDocumentWriterProjectionWithContext(
  input: Omit<DocumentWriterProjectionVerificationInput, "execSql">,
  checkpointContext: ProjectionCheckpointContext,
): Promise<VerifiedDocumentLinkSetManifest> {
  const principalPolicyCache =
    input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
  const containerPathByManifestHash = await verifyProjectionContainerPaths({
    checkpointContext,
    principalPolicyCache,
    projection: input.projection,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash: input.verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  addBundleByHash(
    bundlesByHash,
    input.projection.documentManifest,
    "Document writer projection manifest",
  );
  const history = input.projection.documentManifestHistory;
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
      checkpointContext,
      containerPathByManifestHash,
      enforceLocalCheckpoint: false,
      label: `Document writer projection manifest history[${index}]`,
      principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  }

  const headManifest = await verifyDocumentManifestBundle({
    bundle: input.projection.documentManifest,
    bundlesByHash,
    checkpointContext,
    containerPathByManifestHash,
    enforceLocalCheckpoint: true,
    label: "Document writer projection",
    principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });

  observeAccessManifestCheckpoints(checkpointContext, {
    verifiedHeads: [headManifest],
    verifiedManifests: [...verifiedByHash.values()],
  });

  return headManifest;
}

export async function verifyDocumentWriterProjection(
  input: DocumentWriterProjectionVerificationInput,
): Promise<VerifiedDocumentLinkSetManifest> {
  const checkpointContext = createProjectionCheckpointContext({
    execSql: input.execSql,
  });
  const verified = await verifyDocumentWriterProjectionWithContext(
    input,
    checkpointContext,
  );
  await commitProjectionCheckpoints(checkpointContext);
  return verified;
}
