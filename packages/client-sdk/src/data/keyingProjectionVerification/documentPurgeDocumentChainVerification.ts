import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedAccessManifestSnapshot,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedDocumentLinkSetSnapshot,
  verifyDocumentLinkSetSnapshot,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentPurgeProofResponse,
} from "@tearleads/validators/response";
import { readCanonicalJson } from "../keyingCanonicalJson";
import {
  addBundleByHash,
  assertCanonicalEqual,
  verifyAccessEventBundle,
} from "./bundleVerification";
import {
  observeAccessManifestCheckpoints,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import { ProjectionDependencyUnavailableError } from "./dependencyUnavailable";
import { verifyDocumentManifestBundle } from "./documentManifestVerification";
import { loadManifestCheckpointVerification } from "./manifestCheckpointVerification";
import { readAccessManifest, readDocumentAccessEventBody } from "./readers";
import type { PrincipalPolicyCache, ProjectionUserKeyResolver } from "./types";

async function verifyPinnedChainEndpoint(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly checkpointContext: ProjectionCheckpointContext;
}): Promise<VerifiedDocumentLinkSetSnapshot> {
  const manifest = readAccessManifest(
    input.bundle.manifest,
    "Document purge predecessor endpoint manifest",
  );
  const checkpointVerification = await loadManifestCheckpointVerification({
    current: manifest,
    execSql: input.checkpointContext.execSql,
    localCheckpoints: input.checkpointContext.localCheckpoints,
    verifiedManifests: new Map(),
  });
  const localCheckpoint = checkpointVerification.localCheckpoint;
  if (!localCheckpoint) {
    throw new ProjectionDependencyUnavailableError(
      "Document purge history needs a local checkpoint or signed genesis",
    );
  }
  if (
    localCheckpoint.epoch !== manifest.epoch ||
    localCheckpoint.manifestHash !== input.bundle.manifestHash
  ) {
    throw new KeyingVerificationError(
      localCheckpoint.epoch > manifest.epoch ? "rollback" : "stale_predecessor",
      "Document purge predecessor chain does not start at the local checkpoint",
    );
  }
  const verified = await verifyDocumentLinkSetSnapshot({
    ...checkpointVerification,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    state: input.bundle.state,
  });
  if (!verified.ok) throw verified.error;
  assertCanonicalEqual({
    actual: input.bundle.state,
    expected: readCanonicalJson(
      verified.value.state,
      "Document purge predecessor endpoint state",
    ),
    label: "Document purge predecessor endpoint state",
  });
  return verified.value;
}

async function recordSnapshotContainerEvidence(input: {
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly manifest: VerifiedDocumentLinkSetSnapshot;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly usedContainerManifests?:
    | Map<string, VerifiedContainerAccessManifest>
    | undefined;
}): Promise<void> {
  if (!input.usedContainerManifests) return;
  const event = await verifyAccessEventBundle({
    bundle: input.proof.documentManifest,
    label: "Document purge manifest snapshot",
    resolveUserKey: input.resolveUserKey,
  });
  if (event.eventHash !== input.manifest.manifest.eventHash) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Document purge manifest snapshot event is not bound to its manifest",
    );
  }
  const body = readDocumentAccessEventBody(
    event.body,
    "Document purge manifest snapshot event body",
  );
  const manifestHashes = [
    ...event.event.dependencyManifestHashes,
    body.containerManifestHash,
  ];
  for (const manifestHash of manifestHashes) {
    for (const containerManifest of input.containerPathByManifestHash.get(
      manifestHash,
    ) ?? []) {
      input.usedContainerManifests.set(
        containerManifest.manifestHash,
        containerManifest,
      );
    }
  }
}

async function verifyPurgeChainEndpoint(
  input: Parameters<typeof verifySignedPurgeDocumentManifestChain>[0] & {
    readonly endpoint: AccessManifestBundleWireResponse;
    readonly bundlesByHash: ReadonlyMap<
      string,
      AccessManifestBundleWireResponse
    >;
    readonly verifiedByHash: Map<string, VerifiedDocumentLinkSetManifest>;
  },
): Promise<VerifiedDocumentLinkSetSnapshot | null> {
  const endpointManifest = readAccessManifest(
    input.endpoint.manifest,
    "Document purge chain endpoint",
  );
  if (endpointManifest.previousManifestHash === null) {
    await verifyDocumentManifestBundle({
      ...input,
      authorizationMembership: "referenced",
      bundle: input.endpoint,
      enforceLocalCheckpoint: false,
      label: "Document purge genesis",
      requireAuthorizationEvidence: true,
    });
    return null;
  }
  if (!input.enforceLocalCheckpoints) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Initial document purge history does not reach signed genesis",
    );
  }
  return verifyPinnedChainEndpoint({
    bundle: input.endpoint,
    checkpointContext: input.checkpointContext,
  });
}

async function verifySignedPurgeDocumentManifestChain(input: {
  readonly authorizationEvidence: readonly AnyVerifiedPrincipalPolicy[];
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly enforceLocalCheckpoints: boolean;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly usedContainerManifests?:
    | Map<string, VerifiedContainerAccessManifest>
    | undefined;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  addBundleByHash(
    bundlesByHash,
    input.proof.documentManifest,
    "Document purge manifest",
  );
  for (const [
    index,
    bundle,
  ] of input.proof.documentManifestPredecessors.entries()) {
    addBundleByHash(
      bundlesByHash,
      bundle,
      `Document purge predecessor[${index}]`,
    );
  }

  const endpoint =
    input.proof.documentManifestPredecessors.at(-1) ??
    input.proof.documentManifest;
  const verifiedByHash = new Map<string, VerifiedDocumentLinkSetManifest>();
  const trustedPredecessorByHash = new Map<
    string,
    VerifiedDocumentLinkSetSnapshot
  >();
  const verifiedEndpoint = await verifyPurgeChainEndpoint({
    ...input,
    endpoint,
    bundlesByHash,
    verifiedByHash,
  });
  if (verifiedEndpoint) {
    trustedPredecessorByHash.set(
      verifiedEndpoint.manifestHash,
      verifiedEndpoint,
    );
  }

  const verificationInput = {
    ...input,
    authorizationMembership: "referenced" as const,
    bundlesByHash,
    requireAuthorizationEvidence: true,
    trustedPredecessorByHash,
    verifiedByHash,
  };
  for (
    let index = input.proof.documentManifestPredecessors.length - 2;
    index >= 0;
    index -= 1
  ) {
    const bundle = input.proof.documentManifestPredecessors[index];
    if (!bundle) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `Document purge predecessor[${index}] is missing`,
      );
    }
    await verifyDocumentManifestBundle({
      ...verificationInput,
      bundle,
      enforceLocalCheckpoint: false,
      label: `Document purge predecessor[${index}]`,
    });
  }
  const head = await verifyDocumentManifestBundle({
    ...verificationInput,
    bundle: input.proof.documentManifest,
    enforceLocalCheckpoint: input.enforceLocalCheckpoints,
    label: "Document purge manifest",
  });
  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: [head],
    verifiedManifests: [...verifiedByHash.values()],
  });
  return head;
}

export async function verifyPurgeDocumentManifest(input: {
  readonly authorizationEvidence: readonly AnyVerifiedPrincipalPolicy[];
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly enforceLocalCheckpoints: boolean;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly usedContainerManifests?:
    | Map<string, VerifiedContainerAccessManifest>
    | undefined;
}): Promise<VerifiedDocumentLinkSetManifest | VerifiedDocumentLinkSetSnapshot> {
  const verifiedByHash = new Map<string, VerifiedAccessManifestSnapshot>();
  const manifest = readAccessManifest(
    input.proof.documentManifest.manifest,
    "Document purge manifest snapshot",
  );
  const checkpointVerification = input.enforceLocalCheckpoints
    ? await loadManifestCheckpointVerification({
        current: manifest,
        execSql: input.checkpointContext.execSql,
        localCheckpoints: input.checkpointContext.localCheckpoints,
        verifiedManifests: verifiedByHash,
      })
    : undefined;
  const localCheckpoint = checkpointVerification?.localCheckpoint;
  const isPinnedHead =
    localCheckpoint?.epoch === manifest.epoch &&
    localCheckpoint.manifestHash === input.proof.documentManifest.manifestHash;
  // A hash-only snapshot may select a read-only refetch floor. Committing a
  // purge requires an exact existing pin or verified signed transitions from
  // that pin (or signed genesis for a fresh device).
  if (
    (input.enforceLocalCheckpoints && !isPinnedHead) ||
    (!input.enforceLocalCheckpoints &&
      input.proof.documentManifestPredecessors.length > 0)
  ) {
    return verifySignedPurgeDocumentManifestChain(input);
  }
  const verified = await verifyDocumentLinkSetSnapshot({
    ...(checkpointVerification ?? {}),
    expectedManifestHash: input.proof.documentManifest.manifestHash,
    manifest,
    state: input.proof.documentManifest.state,
  });
  if (!verified.ok) throw verified.error;
  const documentManifest = verified.value;
  await recordSnapshotContainerEvidence({
    containerPathByManifestHash: input.containerPathByManifestHash,
    manifest: documentManifest,
    proof: input.proof,
    resolveUserKey: input.resolveUserKey,
    usedContainerManifests: input.usedContainerManifests,
  });
  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: [documentManifest],
    verifiedManifests: [...verifiedByHash.values()],
  });
  return documentManifest;
}
