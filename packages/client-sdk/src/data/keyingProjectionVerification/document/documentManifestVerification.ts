import type { PrincipalPolicyAuthorization } from "@tearleads/crypto";
import {
  KeyingVerificationError,
  readKeyingCanonicalJson,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedDocumentLinkSetSnapshot,
  verifyDocumentLinkSetManifest,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  addBundleByHash,
  assertCanonicalEqual,
  verifyAccessEventBundle,
} from "../checkpoints/bundleVerification";
import type { ProjectionCheckpointContext } from "../checkpoints/checkpointContext";
import {
  loadManifestCheckpointVerification,
  verifyCachedManifestCheckpoint,
} from "../checkpoints/manifestCheckpointVerification";
import {
  assertUnchangedSinceVerification,
  matchesVerifiedBundleBytes,
  recordVerifiedBundleBytes,
} from "../checkpoints/verifiedBundleBytes";
import { readAccessManifest, readDocumentAccessEventBody } from "../readers";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../types";
import { resolveEventContainerPaths } from "./documentDependencyPaths";
import {
  collectDocumentManifestPrincipalPolicies,
  recordUsedDocumentContainerManifests,
  type UsedDocumentContainerManifests,
} from "./documentManifestPolicies";
import { requireVerifiedDocumentPredecessor } from "./documentManifestPredecessor";

type PolicyWarmer = ReferencedPrincipalPolicyWarmer | undefined;

function assertVerifiedState(
  input: {
    readonly bundle: AccessManifestBundleWireResponse;
    readonly label: string;
  },
  verified: VerifiedDocumentLinkSetManifest,
): void {
  assertCanonicalEqual({
    actual: input.bundle.state,
    expected: readKeyingCanonicalJson(verified.state, `${input.label} state`),
    label: `${input.label} state`,
  });
}

export async function verifyDocumentManifestBundle(input: {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly authorizationEvidence?:
    | readonly PrincipalPolicyAuthorization[]
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
  // A cache hit vouches for the bytes it verified; a copy that differs is
  // verified afresh.
  if (cached && matchesVerifiedBundleBytes(cached, input.bundle)) {
    assertVerifiedState(input, cached);
    if (input.enforceLocalCheckpoint) {
      await verifyCachedManifestCheckpoint({
        current: cached,
        execSql: input.checkpointContext.execSql,
        localCheckpoints: input.checkpointContext.localCheckpoints,
        verifiedManifests: input.verifiedByHash,
      });
      // The caller reads this bundle on return, after the checkpoint read.
      assertUnchangedSinceVerification(cached, input.bundle, input.label);
      assertVerifiedState(input, cached);
    }
    return cached;
  }
  // Verify and record one copy taken before the first await, so the bytes
  // recorded as verified are exactly the bytes verified.
  const verified = await verifyFreshDocumentManifestBundle({
    ...input,
    bundle: structuredClone(input.bundle),
  });
  assertUnchangedSinceVerification(verified, input.bundle, input.label);
  assertVerifiedState(input, verified);
  return verified;
}

async function verifyFreshDocumentManifestBundle(
  input: Parameters<typeof verifyDocumentManifestBundle>[0],
): Promise<VerifiedDocumentLinkSetManifest> {
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
  const { dependencyContainerPaths, targetContainerPath } =
    resolveEventContainerPaths({
      containerPathByManifestHash: input.containerPathByManifestHash,
      dependencyManifestHashes: event.event.dependencyManifestHashes,
      targetManifestHash: body.containerManifestHash,
    });
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
        localCheckpoints: input.checkpointContext.localCheckpoints,
        verifiedManifests: input.verifiedByHash,
      })
    : null;
  const verified = await verifyDocumentLinkSetManifest({
    // Served heads and history were committed under the group membership their
    // cited container heads referenced; a signer removed since must still
    // verify on a cold device. The API verifier gates new writes at current.
    authorizationMembership: input.authorizationMembership ?? "referenced",
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
  assertVerifiedState(input, verified.value);
  input.verifiedByHash.set(input.bundle.manifestHash, verified.value);
  recordVerifiedBundleBytes(verified.value, input.bundle);

  return verified.value;
}

export async function verifyDocumentProjectionManifests(
  input: Omit<
    Parameters<typeof verifyDocumentManifestBundle>[0],
    | "bundle"
    | "bundlesByHash"
    | "enforceLocalCheckpoint"
    | "label"
    | "verifiedByHash"
  > & { readonly projection: DocumentWriterProjectionResponse },
) {
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
  // An honest API never lists the head in its own history (it seeds the walk
  // with the head), so a repeat is a malformed or tampered projection and is
  // refused as such, rather than letting the head reach its verification
  // through the history cache and relying on the cached branch to re-run
  // every check the fresh path would.
  if (
    history.some(
      (bundle) =>
        bundle.manifestHash === input.projection.documentManifest.manifestHash,
    )
  ) {
    throw new KeyingVerificationError(
      "duplicate_entry",
      "Document writer projection history repeats the current head",
    );
  }

  const verifiedByHash = new Map<string, VerifiedDocumentLinkSetManifest>();
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const bundle = history[index];
    if (!bundle) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `Document writer projection manifest history[${index}] is missing`,
      );
    }
    await verifyDocumentManifestBundle({
      authorizationEvidence: input.authorizationEvidence,
      requireAuthorizationEvidence: true,
      bundle,
      bundlesByHash,
      checkpointContext: input.checkpointContext,
      containerPathByManifestHash: input.containerPathByManifestHash,
      enforceLocalCheckpoint: false,
      label: `Document writer projection manifest history[${index}]`,
      principalPolicyCache: input.principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  }

  const headManifest = await verifyDocumentManifestBundle({
    authorizationEvidence: input.authorizationEvidence,
    requireAuthorizationEvidence: true,
    bundle: input.projection.documentManifest,
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    containerPathByManifestHash: input.containerPathByManifestHash,
    enforceLocalCheckpoint: true,
    label: "Document writer projection",
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return { headManifest, verifiedByHash };
}
