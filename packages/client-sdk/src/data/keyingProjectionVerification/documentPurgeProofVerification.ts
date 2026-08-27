import {
  type AccessManifestCheckpoint,
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicy,
  verifyAccessManifestLocalCheckpoint,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentPurgeProofResponse,
} from "@symcrypt/validators/response";
import type { ExecSql } from "../sqlite/sqlSchema";
import { addBundleByHash } from "./bundleVerification";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
  observeAccessManifestCheckpoints,
  observePrincipalPolicy,
} from "./checkpointContext";
import {
  verifiedContainerManifestsForBundles,
  verifyContainerManifestPath,
} from "./containerProjectionVerification";
import { authenticateDocumentPurgeArtifacts } from "./documentPurgePrincipalEvidence";
import { rethrowDatabaseUnavailableError } from "./error";
import { loadManifestCheckpointVerification } from "./manifestCheckpointVerification";
import {
  enforcePrincipalPolicySnapshotCheckpoints,
  verifyPrincipalPolicySnapshots,
} from "./principalPolicySnapshotVerification";
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
  for (const [index, bundle] of proof.authorizingContainerPath.entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Document purge authorizing container path[${index}]`,
    );
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
  for (const [
    pathIndex,
    path,
  ] of proof.documentManifestContainerPaths.entries()) {
    for (const [bundleIndex, bundle] of path.entries()) {
      addBundleByHash(
        bundlesByHash,
        bundle,
        `Document purge dependency path[${pathIndex}][${bundleIndex}]`,
      );
    }
  }
  return bundlesByHash;
}

async function verifyCheckpointChain(input: {
  readonly authorizingManifest: VerifiedContainerAccessManifest;
  readonly chain: DocumentPurgeProofResponse["authorizingContainerCheckpointChains"][number];
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly enforceLocalCheckpoints: boolean;
  readonly index: number;
  readonly verifiedContainerManifests: ReadonlyMap<
    string,
    VerifiedContainerAccessManifest
  >;
}): Promise<VerifiedAccessManifestCheckpointEvidence> {
  // A manifest chain proves ancestry, not when this separate purge signature
  // was made. Accepting H1 -> H2 here would let a writer revoked at H2 sign a
  // purge against stale H1 afterward. Until purge ordering is committed by a
  // shared signed log, even a legitimate purge-before-H2 is deliberately an
  // availability failure: the client must fail closed instead of guessing.
  if (input.chain.length > 0) {
    throw new KeyingVerificationError(
      "stale_predecessor",
      `Document purge authorization path[${input.index}] predates a later container checkpoint without signed purge ordering`,
    );
  }

  if (input.enforceLocalCheckpoints) {
    const checkpointVerification = await loadManifestCheckpointVerification({
      current: input.authorizingManifest.manifest,
      execSql: input.checkpointContext.execSql,
      verifiedManifests: input.verifiedContainerManifests,
    });
    verifyAccessManifestLocalCheckpoint({
      checkpointPredecessors: checkpointVerification.checkpointPredecessors,
      current: {
        ...input.authorizingManifest.checkpoint,
        previousManifestHash:
          input.authorizingManifest.manifest.previousManifestHash,
      },
      localCheckpoint: checkpointVerification.localCheckpoint,
    });
  }
  return input.authorizingManifest;
}

async function verifyPurgeCheckpointHeads(input: {
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly enforceLocalCheckpoints: boolean;
  readonly proof: DocumentPurgeProofResponse;
  readonly verifiedContainerManifests: ReadonlyMap<
    string,
    VerifiedContainerAccessManifest
  >;
}): Promise<VerifiedAccessManifestCheckpointEvidence[]> {
  if (
    input.proof.authorizingContainerCheckpointChains.length !==
    input.authorizingContainerPath.length
  ) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Document purge checkpoint chains do not match the signed authorization path",
    );
  }
  const checkpointHeads: VerifiedAccessManifestCheckpointEvidence[] = [];
  for (const [
    index,
    chain,
  ] of input.proof.authorizingContainerCheckpointChains.entries()) {
    const authorizingManifest = input.authorizingContainerPath[index];
    if (!authorizingManifest) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Document purge checkpoint chain has no signed authorization manifest",
      );
    }
    const checkpointHead = await verifyCheckpointChain({
      authorizingManifest,
      chain,
      checkpointContext: input.checkpointContext,
      enforceLocalCheckpoints: input.enforceLocalCheckpoints,
      index,
      verifiedContainerManifests: input.verifiedContainerManifests,
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
  const containerPathByManifestHash = new Map<
    string,
    readonly VerifiedContainerAccessManifest[]
  >();
  containerPathByManifestHash.set(authorizingLeaf.manifestHash, [
    ...authorizingContainerPath,
  ]);
  for (const [
    index,
    path,
  ] of input.proof.documentManifestContainerPaths.entries()) {
    const verifiedPath = await verifyContainerManifestPath({
      authorizationEvidence: input.authorizationEvidence,
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
  const checkpointHeads = await verifyPurgeCheckpointHeads({
    authorizingContainerPath,
    checkpointContext: input.checkpointContext,
    enforceLocalCheckpoints: input.enforceLocalCheckpoints,
    proof: input.proof,
    verifiedContainerManifests: verifiedByHash,
  });

  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: checkpointHeads,
    verifiedManifests: verifiedContainerManifestsForBundles(
      bundlesByHash,
      verifiedByHash,
    ),
  });
  return {
    authorizingContainerPath,
    containerPathByManifestHash,
    verifiedContainerManifests: new Map(verifiedByHash),
  };
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
    const {
      authorizingContainerPath,
      containerPathByManifestHash,
      verifiedContainerManifests,
    } = await verifyPurgeContainerPaths({
      authorizationEvidence,
      checkpointContext,
      enforceLocalCheckpoints,
      principalPolicyCache,
      proof: input.proof,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    const { documentManifest, principalPolicies, purgeEventHash } =
      await authenticateDocumentPurgeArtifacts({
        authorizationEvidence,
        authorizingContainerPath,
        checkpointContext,
        containerPathByManifestHash,
        enforceLocalCheckpoints,
        expectedDocumentId: input.expectedDocumentId,
        principalPolicyCache,
        proof: input.proof,
        resolveUserKey: input.resolveUserKey,
        verifiedContainerManifests,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      });
    if (enforceLocalCheckpoints) {
      const policiesToPin = await enforcePrincipalPolicySnapshotCheckpoints({
        execSql: input.execSql,
        policies: principalPolicies,
      });
      for (const policy of policiesToPin) {
        observePrincipalPolicy(checkpointContext, policy);
      }
    }
    const documentPurgeCheckpoint = {
      documentId: input.expectedDocumentId,
      documentManifestHash: documentManifest.manifestHash,
      organizationId: documentManifest.state.organizationId,
      purgeEventHash,
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
    input.proof.authorizingContainerCheckpointChains.length !==
      input.proof.authorizingContainerPath.length ||
    input.proof.authorizingContainerCheckpointChains.some(
      (chain) => chain.length !== 0,
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
