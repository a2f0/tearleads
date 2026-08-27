import {
  type AccessManifestCheckpoint,
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicy,
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
import {
  enforcePrincipalPolicySnapshotCheckpoints,
  verifyPrincipalPolicySnapshots,
} from "./principalPolicySnapshotVerification";
import type { PrincipalPolicyCache, ProjectionUserKeyResolver } from "./types";

interface VerifyDocumentPurgeProofInput {
  readonly execSql: ExecSql;
  readonly expectedDocumentId: string;
  readonly expectedOrganizationId: string;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}

interface VerifiedDocumentPurgeProofCommit {
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

async function verifyPurgeContainerPaths(input: {
  readonly authorizationEvidence: readonly AnyVerifiedPrincipalPolicy[];
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly enforceLocalCheckpoints: boolean;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}) {
  const bundlesByHash = collectContainerBundles(input.proof);
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const authorizingContainerPath = await verifyContainerManifestPath({
    authorizationMembership: "referenced",
    authorizationEvidence: input.authorizationEvidence,
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    // This signed path is the purge's authorization boundary. A later local
    // head makes the purge ambiguous because ancestry does not order the purge
    // signature; fail closed instead of accepting server-supplied descendants.
    enforceLocalCheckpoints: input.enforceLocalCheckpoints,
    label: "Document purge authorizing container path",
    path: input.proof.authorizingContainerPath,
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    requireAuthorizationEvidence: true,
    verifiedByHash,
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
      authorizationMembership: "referenced",
      authorizationEvidence: input.authorizationEvidence,
      bundlesByHash,
      checkpointContext: input.checkpointContext,
      enforceLocalCheckpoints: false,
      label: `Document purge dependency path[${index}]`,
      path,
      principalPolicyCache: input.principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      requireAuthorizationEvidence: true,
      verifiedByHash,
    });
    const leaf = verifiedPath.at(-1);
    if (leaf) {
      containerPathByManifestHash.set(leaf.manifestHash, verifiedPath);
    }
  }
  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: authorizingContainerPath,
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
      });
    if (
      documentManifest.state.organizationId !== input.expectedOrganizationId
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Document purge proof belongs to another organization",
      );
    }
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
): Promise<Pick<VerifiedDocumentPurgeProofCommit, "documentCheckpoint">> {
  if (input.proof.documentManifestPredecessors.length !== 0) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Initial document purge proof is not purge-time bounded",
    );
  }
  const verified = await verifyDocumentPurgeProofWithMode(input, false);
  return {
    documentCheckpoint: verified.documentCheckpoint,
  };
}

export function verifyDocumentPurgeProof(
  input: VerifyDocumentPurgeProofInput,
): Promise<VerifiedDocumentPurgeProofCommit> {
  return verifyDocumentPurgeProofWithMode(input, true);
}
