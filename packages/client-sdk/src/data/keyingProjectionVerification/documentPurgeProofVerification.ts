import {
  type AccessManifestCheckpoint,
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  principalPolicyMatchesReference,
  type VerifiedAccessManifestSnapshot,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetSnapshot,
  type VerifiedPrincipalPolicy,
  verifyAccessManifestSnapshot,
  verifyDocumentLinkSetSnapshot,
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
  verifiedContainerManifestsForBundles,
  verifyContainerManifestPath,
} from "./containerProjectionVerification";
import { rethrowDatabaseUnavailableError } from "./error";
import { loadManifestCheckpointVerification } from "./manifestCheckpointVerification";
import { verifyPrincipalPolicySnapshots } from "./principalPolicySnapshotVerification";
import { readAccessManifest } from "./readers";
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

interface VerifiedDocumentPurgeProofCommit {
  readonly authorizingContainerCheckpoints: readonly AccessManifestCheckpoint[];
  readonly commitCheckpoints: (execSql?: ExecSql) => Promise<void>;
  readonly documentCheckpoint: AccessManifestCheckpoint;
}

function collectContainerBundles(
  proof: DocumentPurgeProofResponse,
): Map<string, AccessManifestBundleWireResponse> {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  const paths = [
    proof.authorizingContainerCheckpointHeads,
    proof.authorizingContainerPath,
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
  readonly authorizationEvidence: readonly AnyVerifiedPrincipalPolicy[];
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly enforceLocalCheckpoints: boolean;
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
      authorizationEvidence: input.authorizationEvidence,
      bundle,
      bundlesByHash: input.bundlesByHash,
      checkpointContext: input.checkpointContext,
      enforceLocalCheckpoint: input.enforceLocalCheckpoints,
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
  readonly authorizationEvidence: readonly AnyVerifiedPrincipalPolicy[];
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly enforceLocalCheckpoints: boolean;
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
    authorizationEvidence: input.authorizationEvidence,
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
  const authorizingLeaf = authorizingContainerPath.at(-1);
  if (!authorizingLeaf) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Document purge authorizing container path is empty",
    );
  }
  const checkpointHeads = await verifyPurgeCheckpointHeads({
    authorizationEvidence: input.authorizationEvidence,
    authorizingContainerPath,
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    enforceLocalCheckpoints: input.enforceLocalCheckpoints,
    principalPolicyCache: input.principalPolicyCache,
    proof: input.proof,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });

  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: checkpointHeads,
    verifiedManifests: verifiedContainerManifestsForBundles(
      bundlesByHash,
      verifiedByHash,
    ),
  });
  return authorizingContainerPath;
}

async function verifyPurgeDocumentManifest(input: {
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly enforceLocalCheckpoints: boolean;
  readonly proof: DocumentPurgeProofResponse;
}): Promise<VerifiedDocumentLinkSetSnapshot> {
  const verifiedByHash = new Map<string, VerifiedAccessManifestSnapshot>();
  for (const [
    index,
    predecessor,
  ] of input.proof.documentManifestPredecessors.entries()) {
    const verified = await verifyAccessManifestSnapshot({
      expectedManifestHash: predecessor.manifestHash,
      manifest: readAccessManifest(
        predecessor.manifest,
        `Document purge predecessor snapshot[${index}]`,
      ),
    });
    if (!verified.ok) {
      throw verified.error;
    }
    verifiedByHash.set(verified.value.manifestHash, verified.value);
  }
  const manifest = readAccessManifest(
    input.proof.documentManifest.manifest,
    "Document purge manifest snapshot",
  );
  const checkpointVerification = input.enforceLocalCheckpoints
    ? await loadManifestCheckpointVerification({
        current: manifest,
        execSql: input.checkpointContext.execSql,
        verifiedManifests: verifiedByHash,
      })
    : undefined;
  const verified = await verifyDocumentLinkSetSnapshot({
    ...(checkpointVerification ?? {}),
    expectedManifestHash: input.proof.documentManifest.manifestHash,
    manifest,
    state: input.proof.documentManifest.state,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  const documentManifest = verified.value;
  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: [documentManifest],
    verifiedManifests: [...verifiedByHash.values()],
  });
  return documentManifest;
}

async function verifyDocumentPurgeProofWithMode(
  input: VerifyDocumentPurgeProofInput,
  enforceLocalCheckpoints: boolean,
): Promise<VerifiedDocumentPurgeProofCommit> {
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
    const authorizationEvidence = await verifyPrincipalPolicySnapshots({
      resolveUserKey: input.resolveUserKey,
      snapshots: input.proof.principalPolicySnapshots,
    });
    const authorizingContainerPath = await verifyPurgeContainerPaths({
      authorizationEvidence,
      checkpointContext,
      enforceLocalCheckpoints,
      principalPolicyCache,
      proof: input.proof,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    const documentManifest = await verifyPurgeDocumentManifest({
      checkpointContext,
      enforceLocalCheckpoints,
      proof: input.proof,
    });
    const event = await verifyStandaloneAccessEventBundle({
      bundle: input.proof.purgeEvent,
      label: "Document purge event",
      resolveUserKey: input.resolveUserKey,
    });
    for (const reference of authorizingContainerPath.flatMap(
      (manifest) => manifest.state.referencedPrincipalHeads,
    )) {
      if (
        !authorizationEvidence.some((policy) =>
          principalPolicyMatchesReference({ policy, reference }),
        )
      ) {
        throw new KeyingVerificationError(
          "missing_dependency",
          "Document purge proof omits referenced principal policy evidence",
        );
      }
    }
    const principalPolicies = authorizationEvidence;
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
    const documentPurgeCheckpoint = {
      documentId: input.expectedDocumentId,
      documentManifestHash: documentManifest.manifestHash,
      organizationId: documentManifest.state.organizationId,
      purgeEventHash: verified.value.eventHash,
    };
    return {
      authorizingContainerCheckpoints: authorizingContainerPath.map(
        (manifest) => manifest.checkpoint,
      ),
      commitCheckpoints: (execSql = input.execSql) =>
        commitProjectionCheckpoints(checkpointContext, {
          documentPurgeCheckpoint,
          execSql,
        }),
      documentCheckpoint: documentManifest.checkpoint,
    };
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

export async function verifyDocumentPurgeProofBaseline(
  input: VerifyDocumentPurgeProofInput,
): Promise<
  Pick<
    VerifiedDocumentPurgeProofCommit,
    "authorizingContainerCheckpoints" | "documentCheckpoint"
  >
> {
  if (
    input.proof.authorizingContainerCheckpointHeads.length !==
      input.proof.authorizingContainerPath.length ||
    input.proof.authorizingContainerCheckpointHeads.some(
      (head, index) =>
        head.manifestHash !==
        input.proof.authorizingContainerPath[index]?.manifestHash,
    ) ||
    input.proof.documentManifestPredecessors.length !== 0
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Initial document purge proof is not purge-time bounded",
    );
  }
  const verified = await verifyDocumentPurgeProofWithMode(input, false);
  return {
    authorizingContainerCheckpoints: verified.authorizingContainerCheckpoints,
    documentCheckpoint: verified.documentCheckpoint,
  };
}

export function verifyDocumentPurgeProof(
  input: VerifyDocumentPurgeProofInput,
): Promise<VerifiedDocumentPurgeProofCommit> {
  return verifyDocumentPurgeProofWithMode(input, true);
}
