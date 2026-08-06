import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedPrincipalPolicy,
  verifyDocumentLinkSetManifest,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
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
  collectPrincipalPoliciesForContainerPaths,
  verifiedContainerManifestsForBundles,
  verifyContainerManifestPath,
  verifyContainerWriterProjectionWithContext,
} from "./containerProjectionVerification";
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
