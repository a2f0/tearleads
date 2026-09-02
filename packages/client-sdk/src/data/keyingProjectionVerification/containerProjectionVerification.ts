import {
  type AnyVerifiedPrincipalPolicy,
  type ContainerUserRecipientKey,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  KeyingVerificationError,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  type VerifiedContainerKekState,
  type VerifiedPrincipalPolicy,
  verifyContainerKekState,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../sqlite/sqlSchema";
import { addBundleByHash } from "./bundleVerification";
import {
  createProjectionCheckpointContext,
  finalizeProjectionCheckpoints,
  observeAccessManifestCheckpoints,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import { verifyContainerManifestBundle } from "./containerManifestVerification";
import { rethrowProjectionVerificationBoundaryError } from "./error";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";
import {
  readContainerKekRecipientTarget,
  readContainerKeyEpoch,
  readContainerKeyWrap,
} from "./readers";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";
import {
  assertProjectionVerificationCurrent,
  generationGuardedPrincipalPolicyWarmer,
  withGenerationGuardedPolicyWarmer,
} from "./types";

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

export async function verifyContainerManifestPath(input: {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly authorizationEvidence?:
    | readonly AnyVerifiedPrincipalPolicy[]
    | undefined;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly enforceLocalCheckpoints: boolean;
  readonly label: string;
  readonly path: readonly AccessManifestBundleWireResponse[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly requireAuthorizationEvidence?: boolean | undefined;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedContainerAccessManifest[]> {
  const verifiedPath: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of input.path.entries()) {
    verifiedPath.push(
      await verifyContainerManifestBundle({
        authorizationMembership: input.authorizationMembership,
        authorizationEvidence: input.authorizationEvidence,
        bundle,
        bundlesByHash: input.bundlesByHash,
        checkpointContext: input.checkpointContext,
        enforceLocalCheckpoint: input.enforceLocalCheckpoints,
        label: `${input.label}[${index}]`,
        parentPath: verifiedPath,
        principalPolicyCache: input.principalPolicyCache,
        resolveUserKey: input.resolveUserKey,
        requireAuthorizationEvidence: input.requireAuthorizationEvidence,
        verifiedByHash: input.verifiedByHash,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      }),
    );
  }

  return verifiedPath;
}

interface ContainerWriterProjectionVerificationInput {
  readonly execSql: ExecSql;
  readonly persistVerificationCheckpoints?: boolean | undefined;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly verifiedByHash?:
    | Map<string, VerifiedContainerAccessManifest>
    | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

export function verifiedContainerManifestsForBundles(
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
  addContainerWriterProjectionBundles(
    bundlesByHash,
    projection,
    "Container writer projection",
  );
  return bundlesByHash;
}

export async function verifyContainerWriterProjectionWithContext(
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
  try {
    assertProjectionVerificationCurrent(input.stillCurrent);
    const guardedInput = withGenerationGuardedPolicyWarmer(input);
    const checkpointContext = createProjectionCheckpointContext({
      execSql: input.execSql,
      organizationId: input.projection.organizationId,
    });
    const verifiedPath = await verifyContainerWriterProjectionWithContext(
      guardedInput,
      checkpointContext,
    );
    assertProjectionVerificationCurrent(input.stillCurrent);
    await finalizeProjectionCheckpoints(checkpointContext, input);
    assertProjectionVerificationCurrent(input.stillCurrent);
    return verifiedPath;
  } catch (error) {
    rethrowProjectionVerificationBoundaryError(error);
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    throw new KeyingVerificationError(
      "invalid_shape",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function collectContainerWriterProjectionPrincipalPolicies(input: {
  readonly execSql: ExecSql;
  readonly persistVerificationCheckpoints?: boolean | undefined;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  try {
    assertProjectionVerificationCurrent(input.stillCurrent);
    const warmReferencedPrincipalPolicies =
      generationGuardedPrincipalPolicyWarmer(
        input.warmReferencedPrincipalPolicies,
        input.stillCurrent,
      );
    const principalPolicyCache =
      input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
    const checkpointContext = createProjectionCheckpointContext({
      execSql: input.execSql,
      organizationId: input.projection.organizationId,
    });
    const verifiedPath = await verifyContainerWriterProjectionWithContext(
      {
        principalPolicyCache,
        projection: input.projection,
        resolveUserKey: input.resolveUserKey,
        warmReferencedPrincipalPolicies,
      },
      checkpointContext,
    );
    assertProjectionVerificationCurrent(input.stillCurrent);

    const policies = await collectPrincipalPoliciesForContainerPaths({
      checkpointContext,
      organizationId: input.projection.organizationId,
      paths: [verifiedPath],
      principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies,
    });
    assertProjectionVerificationCurrent(input.stillCurrent);
    await finalizeProjectionCheckpoints(checkpointContext, input);
    assertProjectionVerificationCurrent(input.stillCurrent);
    return policies;
  } catch (error) {
    rethrowProjectionVerificationBoundaryError(error);
    throw error;
  }
}

export function addContainerWriterProjectionBundles(
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
