import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedDocumentLinkSetSnapshot,
  type VerifiedPrincipalPolicy,
  verifyDocumentLinkSetManifest,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { readCanonicalJson } from "../keyingCanonicalJson";
import type { ExecSql } from "../sqlite/sqlSchema";
import {
  addBundleByHash,
  assertCanonicalEqual,
  verifyAccessEventBundle,
} from "./bundleVerification";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
  observeAccessManifestCheckpoints,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import {
  addContainerWriterProjectionBundles,
  verifiedContainerManifestsForBundles,
  verifyContainerManifestPath,
  verifyContainerWriterProjectionWithContext,
} from "./containerProjectionVerification";
import {
  collectDocumentManifestPrincipalPolicies,
  recordUsedDocumentContainerManifests,
  type UsedDocumentContainerManifests,
} from "./documentManifestPolicies";
import { requireVerifiedDocumentPredecessor } from "./documentManifestPredecessor";
import { rejectPurgedDocumentProjection } from "./documentPurgeCheckpointEnforcement";
import { rethrowDatabaseUnavailableError } from "./error";
import {
  loadManifestCheckpointVerification,
  verifyCachedManifestCheckpoint,
} from "./manifestCheckpointVerification";
import { readAccessManifest, readDocumentAccessEventBody } from "./readers";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

type VerifiedManifestMap = Map<string, VerifiedContainerAccessManifest>;
type PolicyWarmer = ReferencedPrincipalPolicyWarmer | undefined;

function readDocumentProjectionContainerPaths(
  projection: DocumentWriterProjectionResponse,
): AccessManifestBundleWireResponse[][] {
  return [
    ...projection.documentManifestContainerPaths,
    ...projection.authorizingContainerPaths.map((path) => path.path),
  ];
}

function reconstructVerifiedContainerPath(input: {
  readonly cache: Map<
    string,
    readonly VerifiedContainerAccessManifest[] | null
  >;
  readonly manifestHash: string;
  readonly manifests: ReadonlyMap<string, VerifiedContainerAccessManifest>;
  readonly visiting: Set<string>;
}): readonly VerifiedContainerAccessManifest[] | null {
  const cached = input.cache.get(input.manifestHash);
  if (cached !== undefined) {
    return cached;
  }
  if (input.visiting.has(input.manifestHash)) {
    throw new Error("Verified container history contains a hierarchy cycle");
  }
  const manifest = input.manifests.get(input.manifestHash);
  if (!manifest) {
    input.cache.set(input.manifestHash, null);
    return null;
  }
  const parentManifestHash = manifest.state.parentManifestHash;
  if (parentManifestHash === null) {
    const path = [manifest];
    input.cache.set(input.manifestHash, path);
    return path;
  }

  input.visiting.add(input.manifestHash);
  const parentPath = reconstructVerifiedContainerPath({
    ...input,
    manifestHash: parentManifestHash,
  });
  input.visiting.delete(input.manifestHash);
  const parent = parentPath?.at(-1);
  if (
    !parentPath ||
    !parent ||
    parent.state.containerId !== manifest.state.parentContainerId
  ) {
    input.cache.set(input.manifestHash, null);
    return null;
  }
  const path = [...parentPath, manifest];
  input.cache.set(input.manifestHash, path);
  return path;
}

function addReconstructedVerifiedContainerPaths(input: {
  readonly containerPathByManifestHash: Map<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly manifests: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  const cache = new Map<
    string,
    readonly VerifiedContainerAccessManifest[] | null
  >();
  for (const manifestHash of input.manifests.keys()) {
    const path = reconstructVerifiedContainerPath({
      cache,
      manifestHash,
      manifests: input.manifests,
      visiting: new Set(),
    });
    if (path && !input.containerPathByManifestHash.has(manifestHash)) {
      input.containerPathByManifestHash.set(manifestHash, path);
    }
  }
}

async function verifyProjectionContainerPaths(input: {
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly projection: DocumentWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash?: VerifiedManifestMap | undefined;
  readonly warmReferencedPrincipalPolicies?: PolicyWarmer;
}): Promise<Map<string, readonly VerifiedContainerAccessManifest[]>> {
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
    readonly VerifiedContainerAccessManifest[]
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
    // Historical dependencies provide evidence without advancing heads.
    const verifiedPath = await verifyContainerManifestPath({
      authorizationMembership: "referenced",
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

  addReconstructedVerifiedContainerPaths({
    containerPathByManifestHash,
    manifests: verifiedByHash,
  });

  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: [],
    verifiedManifests: verifiedContainerManifestsForBundles(
      bundlesByHash,
      verifiedByHash,
    ),
  });

  return containerPathByManifestHash;
}
export async function verifyDocumentManifestBundle(input: {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly authorizationEvidence?:
    | readonly AnyVerifiedPrincipalPolicy[]
    | undefined;
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
  readonly requireAuthorizationEvidence?: boolean | undefined;
  readonly trustedPredecessorByHash?:
    | ReadonlyMap<string, VerifiedDocumentLinkSetSnapshot>
    | undefined;
  readonly usedContainerManifests?: UsedDocumentContainerManifests | undefined;
  readonly verifiedByHash: Map<string, VerifiedDocumentLinkSetManifest>;
  readonly warmReferencedPrincipalPolicies?: PolicyWarmer;
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
  const previousManifest = requireVerifiedDocumentPredecessor({
    label: input.label,
    previousManifestHash: event.event.previousManifestHash,
    trustedPredecessorByHash: input.trustedPredecessorByHash,
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
  const principalPolicies = await collectDocumentManifestPrincipalPolicies({
    authorizationEvidence: input.authorizationEvidence,
    checkpointContext: input.checkpointContext,
    organizationId: event.event.organizationId,
    paths: [...dependencyContainerPaths, targetContainerPath],
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    requireAuthorizationEvidence: input.requireAuthorizationEvidence,
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
    authorizationMembership: input.authorizationMembership,
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

  recordUsedDocumentContainerManifests({
    paths: [...dependencyContainerPaths, targetContainerPath],
    used: input.usedContainerManifests,
  });
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
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly verifiedByHash?: VerifiedManifestMap | undefined;
  readonly warmReferencedPrincipalPolicies?: PolicyWarmer;
}

export interface DocumentWriterProjectionAuthorization {
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly documentManifestByHash: ReadonlyMap<
    string,
    VerifiedDocumentLinkSetManifest
  >;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}

interface VerifiedDocumentWriterProjectionResult {
  readonly authorization: DocumentWriterProjectionAuthorization;
  readonly headManifest: VerifiedDocumentLinkSetManifest;
}

async function verifyDocumentWriterProjectionWithContext(
  input: Omit<DocumentWriterProjectionVerificationInput, "execSql">,
  checkpointContext: ProjectionCheckpointContext,
): Promise<VerifiedDocumentWriterProjectionResult> {
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
  await rejectPurgedDocumentProjection(
    headManifest.state.documentId,
    checkpointContext.execSql,
  );

  observeAccessManifestCheckpoints(checkpointContext, {
    verifiedHeads: [headManifest],
    verifiedManifests: [...verifiedByHash.values()],
  });

  return {
    authorization: {
      containerPathByManifestHash,
      documentManifestByHash: verifiedByHash,
      principalPolicies: [...principalPolicyCache.values()],
    },
    headManifest,
  };
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
  await commitProjectionCheckpoints(checkpointContext, input);
  return verified.headManifest;
}

export async function verifyDocumentWriterProjectionAuthorization(
  input: DocumentWriterProjectionVerificationInput,
): Promise<DocumentWriterProjectionAuthorization> {
  try {
    const checkpointContext = createProjectionCheckpointContext({
      execSql: input.execSql,
    });
    const verified = await verifyDocumentWriterProjectionWithContext(
      input,
      checkpointContext,
    );
    await commitProjectionCheckpoints(checkpointContext, input);
    return verified.authorization;
  } catch (error) {
    rethrowDatabaseUnavailableError(error);
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    throw new KeyingVerificationError(
      "invalid_shape",
      error instanceof Error ? error.message : String(error),
    );
  }
}
