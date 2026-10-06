import { retainVerifiedProjectionHistory } from "@tearleads/api-client";
import type {
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { PrincipalPolicyCheckpointEvidence } from "../principals/principalPolicyEvidence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { addBundleByHash } from "./bundleVerification";
import {
  createProjectionCheckpointContext,
  finalizeProjectionCheckpoints,
  observeAccessManifestCheckpoints,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerPathVerification";
import {
  addContainerWriterProjectionBundles,
  verifiedContainerManifestsForBundles,
  verifyContainerWriterProjectionWithContext,
} from "./containerProjectionVerification";
import { documentContainerProjections } from "./documentContainerProjections";
import { verifyDocumentProjectionManifests } from "./documentManifestVerification";
import { rejectPurgedDocumentProjection } from "./documentPurgeCheckpointEnforcement";
import { throwKeyingVerificationShapeFailure } from "./error";
import { verifyProjectionAuthorizationEvidence } from "./projectionAuthorizationEvidence";
import { readAccessManifest } from "./readers";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";
import { withGenerationGuardedPolicyWarmer } from "./types";

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

function collectDocumentProjectionContainerBundles(
  projection: DocumentWriterProjectionResponse,
): Map<string, AccessManifestBundleWireResponse> {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  for (const [index, authorizing] of documentContainerProjections(
    projection,
  ).entries()) {
    addContainerWriterProjectionBundles(
      bundlesByHash,
      authorizing,
      `Document writer projection authorizing path[${index}]`,
    );
  }
  for (const [index, path] of readDocumentProjectionContainerPaths(
    projection,
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
  ] of projection.documentContainerManifestHistory.entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Document writer projection container history[${index}]`,
    );
  }
  return bundlesByHash;
}

async function verifyProjectionContainerPaths(input: {
  readonly authorizationEvidence: readonly PrincipalPolicyCheckpointEvidence[];
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly projection: DocumentWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash?: VerifiedManifestMap | undefined;
  readonly warmReferencedPrincipalPolicies?: PolicyWarmer;
}): Promise<Map<string, readonly VerifiedContainerAccessManifest[]>> {
  const bundlesByHash = collectDocumentProjectionContainerBundles(
    input.projection,
  );
  const containerPathByManifestHash = new Map<
    string,
    readonly VerifiedContainerAccessManifest[]
  >();
  // Reuse a caller-supplied cache when provided so a later unwrap pass over the
  // same authorizing container paths does not re-verify identical manifests.
  const verifiedByHash =
    input.verifiedByHash ?? new Map<string, VerifiedContainerAccessManifest>();
  for (const projection of documentContainerProjections(input.projection)) {
    const path = await verifyContainerWriterProjectionWithContext(
      {
        authorizationEvidence: input.authorizationEvidence,
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
  // Grouping supplies evidence only; each signed artifact selects its citations.
  for (const [
    index,
    path,
  ] of input.projection.documentManifestContainerPaths.entries()) {
    // Historical dependency evidence is verified without current checkpoint
    // enforcement. Its grouping cannot substitute an uncited ancestor into
    // document or content-write authorization.
    const verifiedPath = await verifyContainerManifestPath({
      authorizationEvidence: input.authorizationEvidence,
      requireAuthorizationEvidence: true,
      servedAsCurrent: false,
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
    // The authorizing path recorded for the same leaf takes precedence.
    const leaf = verifiedPath.at(-1);
    if (leaf && !containerPathByManifestHash.has(leaf.manifestHash)) {
      containerPathByManifestHash.set(leaf.manifestHash, verifiedPath);
    }
  }

  // Keep every verified head as evidence. Events and content headers select
  // their own signed paths through resolveEventContainerPaths.
  for (const [hash, manifest] of verifiedByHash) {
    if (!containerPathByManifestHash.has(hash))
      containerPathByManifestHash.set(hash, [manifest]);
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

interface DocumentWriterProjectionVerificationInput {
  readonly execSql: ExecSql;
  readonly persistVerificationCheckpoints?: boolean | undefined;
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
  readonly principalPolicies: readonly PrincipalPolicyCheckpointEvidence[];
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
  const authorizationEvidence = await verifyProjectionAuthorizationEvidence({
    bundles: [
      ...collectDocumentProjectionContainerBundles(input.projection).values(),
    ],
    checkpointContext,
    policyEvidence: input.projection.policyEvidence,
    organizationId: readAccessManifest(
      input.projection.documentManifest.manifest,
      "Document projection manifest",
    ).organizationId,
    principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
  });
  const containerPathByManifestHash = await verifyProjectionContainerPaths({
    authorizationEvidence,
    checkpointContext,
    principalPolicyCache,
    projection: input.projection,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash: input.verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const { headManifest, verifiedByHash } =
    await verifyDocumentProjectionManifests({
      authorizationEvidence,
      checkpointContext,
      containerPathByManifestHash,
      principalPolicyCache,
      projection: input.projection,
      resolveUserKey: input.resolveUserKey,
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
      principalPolicies: authorizationEvidence,
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
    withGenerationGuardedPolicyWarmer(input),
    checkpointContext,
  );
  await finalizeProjectionCheckpoints(checkpointContext, input);
  retainVerifiedProjectionHistory(input.projection);
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
      withGenerationGuardedPolicyWarmer(input),
      checkpointContext,
    );
    await finalizeProjectionCheckpoints(checkpointContext, input);
    retainVerifiedProjectionHistory(input.projection);
    return verified.authorization;
  } catch (error) {
    throwKeyingVerificationShapeFailure(error);
  }
}
