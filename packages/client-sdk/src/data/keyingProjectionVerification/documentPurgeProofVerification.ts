import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedPrincipalPolicy,
  verifyDocumentPurgeEvent,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentPurgeProofResponse,
} from "@symcrypt/validators/response";
import type { ExecSql } from "../sqlite/sqlSchema";
import {
  addBundleByHash,
  verifyStandaloneAccessEventBundle,
} from "./bundleVerification";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
  observeAccessManifestCheckpoints,
} from "./checkpointContext";
import { verifyContainerManifestBundle } from "./containerManifestVerification";
import {
  collectPrincipalPoliciesForContainerPaths,
  verifiedContainerManifestsForBundles,
  verifyContainerManifestPath,
} from "./containerProjectionVerification";
import {
  addReconstructedVerifiedContainerPaths,
  verifyDocumentManifestBundle,
} from "./documentProjectionVerification";
import { rethrowDatabaseUnavailableError } from "./error";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

interface VerifyDocumentPurgeProofInput {
  readonly execSql: ExecSql;
  readonly expectedDocumentId: string;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

function collectContainerBundles(
  proof: DocumentPurgeProofResponse,
): Map<string, AccessManifestBundleWireResponse> {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  const paths = [
    proof.authorizingContainerCheckpointHeads,
    proof.authorizingContainerPath,
    ...proof.documentManifestContainerPaths,
  ];
  for (const [pathIndex, path] of paths.entries()) {
    for (const [index, bundle] of path.entries()) {
      addBundleByHash(
        bundlesByHash,
        bundle,
        `Document purge container path[${pathIndex}][${index}]`,
      );
    }
  }
  for (const [
    index,
    bundle,
  ] of proof.documentContainerManifestHistory.entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Document purge container history[${index}]`,
    );
  }
  return bundlesByHash;
}

function assertCheckpointHeadExtendsSignedPath(input: {
  readonly authorizingManifest: VerifiedContainerAccessManifest;
  readonly checkpointHead: VerifiedContainerAccessManifest;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  let current = input.checkpointHead;
  const visited = new Set<string>();
  while (current.manifestHash !== input.authorizingManifest.manifestHash) {
    if (
      current.state.containerId !==
        input.authorizingManifest.state.containerId ||
      current.state.epoch <= input.authorizingManifest.state.epoch ||
      !current.state.previousManifestHash ||
      visited.has(current.manifestHash)
    ) {
      throw new KeyingVerificationError(
        "stale_predecessor",
        "Document purge checkpoint head does not extend the signed authorization path",
      );
    }
    visited.add(current.manifestHash);
    const previous = input.verifiedByHash.get(
      current.state.previousManifestHash,
    );
    if (!previous) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Document purge checkpoint ordering evidence is incomplete",
      );
    }
    current = previous;
  }
}

async function verifyPurgeCheckpointHeads(input: {
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedContainerAccessManifest[]> {
  if (
    input.proof.authorizingContainerCheckpointHeads.length !==
    input.authorizingContainerPath.length
  ) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Document purge checkpoint heads do not match the signed authorization path",
    );
  }
  const checkpointHeads: VerifiedContainerAccessManifest[] = [];
  for (const [
    index,
    bundle,
  ] of input.proof.authorizingContainerCheckpointHeads.entries()) {
    const authorizingManifest = input.authorizingContainerPath[index];
    if (!authorizingManifest) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Document purge checkpoint head has no signed authorization manifest",
      );
    }
    const checkpointHead = await verifyContainerManifestBundle({
      bundle,
      bundlesByHash: input.bundlesByHash,
      checkpointContext: input.checkpointContext,
      enforceLocalCheckpoint: true,
      label: `Document purge checkpoint head[${index}]`,
      parentPath: input.authorizingContainerPath.slice(0, index),
      principalPolicyCache: input.principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      verifiedByHash: input.verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    assertCheckpointHeadExtendsSignedPath({
      authorizingManifest,
      checkpointHead,
      verifiedByHash: input.verifiedByHash,
    });
    checkpointHeads.push(checkpointHead);
  }
  return checkpointHeads;
}

async function verifyPurgeContainerPaths(input: {
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}) {
  const bundlesByHash = collectContainerBundles(input.proof);
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const authorizingContainerPath = await verifyContainerManifestPath({
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    // The purge event signs this exact historical path. Durable checkpoint
    // comparison happens against the descendant heads verified below.
    enforceLocalCheckpoints: false,
    label: "Document purge authorizing container path",
    path: input.proof.authorizingContainerPath,
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const containerPathByManifestHash = new Map<
    string,
    readonly VerifiedContainerAccessManifest[]
  >();
  const authorizingLeaf = authorizingContainerPath.at(-1);
  if (!authorizingLeaf) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Document purge authorizing container path is empty",
    );
  }
  containerPathByManifestHash.set(
    authorizingLeaf.manifestHash,
    authorizingContainerPath,
  );

  const checkpointHeads = await verifyPurgeCheckpointHeads({
    authorizingContainerPath,
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    principalPolicyCache: input.principalPolicyCache,
    proof: input.proof,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });

  for (const [
    index,
    path,
  ] of input.proof.documentManifestContainerPaths.entries()) {
    const verifiedPath = await verifyContainerManifestPath({
      bundlesByHash,
      checkpointContext: input.checkpointContext,
      enforceLocalCheckpoints: false,
      label: `Document purge dependency path[${index}]`,
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
    verifiedHeads: checkpointHeads,
    verifiedManifests: verifiedContainerManifestsForBundles(
      bundlesByHash,
      verifiedByHash,
    ),
  });
  return { authorizingContainerPath, containerPathByManifestHash };
}

async function verifyPurgeDocumentManifest(input: {
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  addBundleByHash(
    bundlesByHash,
    input.proof.documentManifest,
    "Document purge predecessor manifest",
  );
  for (const [index, bundle] of input.proof.documentManifestHistory.entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Document purge predecessor history[${index}]`,
    );
  }
  const verifiedByHash = new Map<string, VerifiedDocumentLinkSetManifest>();
  for (
    let index = input.proof.documentManifestHistory.length - 1;
    index >= 0;
    index -= 1
  ) {
    const bundle = input.proof.documentManifestHistory[index];
    if (!bundle) {
      throw new Error(
        `Document purge predecessor history[${index}] is missing`,
      );
    }
    await verifyDocumentManifestBundle({
      bundle,
      bundlesByHash,
      checkpointContext: input.checkpointContext,
      containerPathByManifestHash: input.containerPathByManifestHash,
      enforceLocalCheckpoint: false,
      label: `Document purge predecessor history[${index}]`,
      principalPolicyCache: input.principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  }
  const documentManifest = await verifyDocumentManifestBundle({
    bundle: input.proof.documentManifest,
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    containerPathByManifestHash: input.containerPathByManifestHash,
    enforceLocalCheckpoint: true,
    label: "Document purge predecessor",
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: [documentManifest],
    verifiedManifests: [...verifiedByHash.values()],
  });
  return documentManifest;
}

export async function verifyDocumentPurgeProof(
  input: VerifyDocumentPurgeProofInput,
): Promise<void> {
  try {
    if (
      input.proof.documentId !== input.expectedDocumentId ||
      input.proof.documentManifest.manifestHash.length === 0
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Document purge proof targets the wrong document",
      );
    }
    const checkpointContext = createProjectionCheckpointContext({
      execSql: input.execSql,
    });
    const principalPolicyCache =
      input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
    const { authorizingContainerPath, containerPathByManifestHash } =
      await verifyPurgeContainerPaths({
        checkpointContext,
        principalPolicyCache,
        proof: input.proof,
        resolveUserKey: input.resolveUserKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      });
    const documentManifest = await verifyPurgeDocumentManifest({
      checkpointContext,
      containerPathByManifestHash,
      principalPolicyCache,
      proof: input.proof,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    const event = await verifyStandaloneAccessEventBundle({
      bundle: input.proof.purgeEvent,
      label: "Document purge event",
      resolveUserKey: input.resolveUserKey,
    });
    const principalPolicies = await collectPrincipalPoliciesForContainerPaths({
      checkpointContext,
      organizationId: documentManifest.state.organizationId,
      paths: [authorizingContainerPath],
      principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    const verified = await verifyDocumentPurgeEvent({
      authorizingContainerPath,
      documentManifest,
      event,
      expectedDocumentId: input.expectedDocumentId,
      principalPolicies,
    });
    if (!verified.ok) {
      throw verified.error;
    }
    await commitProjectionCheckpoints(checkpointContext, {
      documentPurgeCheckpoint: {
        documentId: input.expectedDocumentId,
        documentManifestHash: documentManifest.manifestHash,
        organizationId: documentManifest.state.organizationId,
        purgeEventHash: verified.value.eventHash,
      },
    });
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
