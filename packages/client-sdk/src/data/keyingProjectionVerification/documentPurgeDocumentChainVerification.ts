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
import { verifyDocumentManifestBundle } from "./documentProjectionVerification";
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
    verifiedManifests: new Map(),
  });
  const localCheckpoint = checkpointVerification.localCheckpoint;
  if (!localCheckpoint) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Document purge predecessor chain has no local checkpoint",
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

async function verifySignedPurgeDocumentManifestChain(input: {
  readonly authorizationEvidence: readonly AnyVerifiedPrincipalPolicy[];
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
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

  const endpoint = input.proof.documentManifestPredecessors.at(-1);
  if (!endpoint) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Signed document purge history has no pinned endpoint",
    );
  }
  const verifiedByHash = new Map<string, VerifiedDocumentLinkSetManifest>();
  const verifiedEndpoint = await verifyPinnedChainEndpoint({
    bundle: endpoint,
    checkpointContext: input.checkpointContext,
  });
  const trustedPredecessorByHash = new Map([
    [verifiedEndpoint.manifestHash, verifiedEndpoint],
  ]);

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
      authorizationMembership: "referenced",
      authorizationEvidence: input.authorizationEvidence,
      bundle,
      bundlesByHash,
      checkpointContext: input.checkpointContext,
      containerPathByManifestHash: input.containerPathByManifestHash,
      enforceLocalCheckpoint: false,
      label: `Document purge predecessor[${index}]`,
      principalPolicyCache: input.principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      requireAuthorizationEvidence: true,
      trustedPredecessorByHash,
      usedContainerManifests: input.usedContainerManifests,
      verifiedByHash,
    });
  }

  const head = await verifyDocumentManifestBundle({
    authorizationMembership: "referenced",
    authorizationEvidence: input.authorizationEvidence,
    bundle: input.proof.documentManifest,
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    containerPathByManifestHash: input.containerPathByManifestHash,
    enforceLocalCheckpoint: false,
    label: "Document purge manifest",
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    requireAuthorizationEvidence: true,
    trustedPredecessorByHash,
    usedContainerManifests: input.usedContainerManifests,
    verifiedByHash,
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
  if (input.proof.documentManifestPredecessors.length > 0) {
    return verifySignedPurgeDocumentManifestChain({
      authorizationEvidence: input.authorizationEvidence,
      checkpointContext: input.checkpointContext,
      containerPathByManifestHash: input.containerPathByManifestHash,
      principalPolicyCache: input.principalPolicyCache,
      proof: input.proof,
      resolveUserKey: input.resolveUserKey,
      usedContainerManifests: input.usedContainerManifests,
    });
  }
  const verifiedByHash = new Map<string, VerifiedAccessManifestSnapshot>();
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
