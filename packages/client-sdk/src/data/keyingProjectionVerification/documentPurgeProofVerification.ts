import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type PrincipalPolicyAuthorization,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentPurgeProofResponse,
} from "@tearleads/validators/response";
import { isDocumentPurgeProofResponse } from "@tearleads/validators/response";
import type { ExecSql } from "../sqlite/sqlSchema";
import { addBundleByHash } from "./bundleVerification";
import {
  createProjectionCheckpointContext,
  observeAccessManifestCheckpoints,
} from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerPathVerification";
import { verifiedContainerManifestsForBundles } from "./containerProjectionVerification";
import {
  commitDocumentPurgeCheckpoints,
  validateDocumentPurgeCheckpoints,
} from "./documentPurgeCheckpointCurrency";
import { authenticateDocumentPurgeArtifacts } from "./documentPurgePrincipalEvidence";
import { observeProjectionLifetime } from "./projectionLifetimes";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";
import { readAccessManifest } from "./readers";
import {
  assertProjectionVerificationCurrent,
  type PrincipalPolicyCache,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
} from "./types";

interface VerifyDocumentPurgeProofInput {
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
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

type PurgeContainerEvidence = Pick<
  DocumentPurgeProofResponse,
  | "authorizingContainerPath"
  | "documentContainerManifestHistory"
  | "documentManifestContainerPaths"
>;

function collectContainerBundles(
  proof: PurgeContainerEvidence,
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

export async function verifyPurgeContainerPaths(input: {
  readonly authorizationEvidence: readonly PrincipalPolicyAuthorization[];
  readonly checkpointContext: ReturnType<
    typeof createProjectionCheckpointContext
  >;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: PurgeContainerEvidence;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}) {
  const bundlesByHash = collectContainerBundles(input.proof);
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const authorizingContainerPath = await verifyContainerManifestPath({
    servedAsCurrent: false,
    authorizationMembership: "referenced",
    authorizationEvidence: input.authorizationEvidence,
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    // Authenticate the signed path here; the complete purge's local currency
    // is checked after its event and document evidence have authenticated.
    enforceLocalCheckpoints: false,
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
      servedAsCurrent: false,
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
    if (leaf && !containerPathByManifestHash.has(leaf.manifestHash)) {
      containerPathByManifestHash.set(leaf.manifestHash, verifiedPath);
    }
  }
  // Purge verification consumes event citations only, never content-write
  // headers, so historical evidence needs no pinned target-path grouping.
  for (const [hash, manifest] of verifiedByHash) {
    if (!containerPathByManifestHash.has(hash)) {
      containerPathByManifestHash.set(hash, [manifest]);
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

function requirePurgeProofShape(
  proof: unknown,
): asserts proof is DocumentPurgeProofResponse {
  if (!isDocumentPurgeProofResponse(proof)) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Document purge proof has an invalid shape",
    );
  }
}

async function recoverPurgePolicyEvidence(
  input: VerifyDocumentPurgeProofInput,
) {
  const references = [...collectContainerBundles(input.proof).values()].flatMap(
    (bundle) =>
      readAccessManifest(bundle.manifest, "Purge container manifest")
        .referencedPrincipalHeads,
  );
  if (
    !references.length &&
    (input.proof.policyEvidence.organization ||
      input.proof.policyEvidence.groups.length ||
      input.proof.policyEvidence.organizationPayloads.length)
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Document purge proof includes unrelated principal policy evidence",
    );
  return verifyProjectionPolicyEvidence({
    evidence: input.proof.policyEvidence,
    organizationId: input.expectedOrganizationId,
    references,
    historicalProof: true,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}

async function verifyDocumentPurgeProofWithMode(
  input: VerifyDocumentPurgeProofInput,
  enforceLocalCheckpoints: boolean,
): Promise<VerifiedDocumentPurgeProofCommit> {
  requirePurgeProofShape(input.proof);
  input = { ...input, proof: structuredClone(input.proof) };
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
    organizationId: input.expectedOrganizationId,
  });
  const principalPolicyCache =
    input.principalPolicyCache ?? new Map<string, VerifiedPrincipalPolicy>();
  const recovered = await recoverPurgePolicyEvidence(input);
  observeProjectionLifetime(checkpointContext, recovered.stillCurrent);
  const authorizationEvidence = recovered.policies;
  const {
    authorizingContainerPath,
    containerPathByManifestHash,
    verifiedContainerManifests,
  } = await verifyPurgeContainerPaths({
    authorizationEvidence,
    checkpointContext,
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
  if (documentManifest.state.organizationId !== input.expectedOrganizationId) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Document purge proof belongs to another organization",
    );
  }
  const observedPrincipalHeads = [
    input.proof.policyEvidence.organization,
    ...input.proof.policyEvidence.groups,
  ].flatMap((source) => (source ? [source.head] : []));
  assertProjectionVerificationCurrent(recovered.stillCurrent);
  if (enforceLocalCheckpoints) {
    await validateDocumentPurgeCheckpoints({
      context: checkpointContext,
      execSql: input.execSql,
      principalPolicies,
      observedPrincipalHeads,
    });
  }
  const documentPurgeCheckpoint = {
    documentId: input.expectedDocumentId,
    documentManifestHash: documentManifest.manifestHash,
    organizationId: documentManifest.state.organizationId,
    purgeEventHash,
  };
  return {
    commitCheckpoints: (execSql = input.execSql) =>
      commitDocumentPurgeCheckpoints({
        context: checkpointContext,
        documentPurgeCheckpoint,
        execSql,
        principalPolicies,
        observedPrincipalHeads,
      }),
    documentCheckpoint: documentManifest.checkpoint,
  };
}

export async function verifyDocumentPurgeProofBaseline(
  input: VerifyDocumentPurgeProofInput,
): Promise<Pick<VerifiedDocumentPurgeProofCommit, "documentCheckpoint">> {
  requirePurgeProofShape(input.proof);
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
