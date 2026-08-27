import {
  KeyingVerificationError,
  type VerifiedAccessManifestSnapshot,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedDocumentLinkSetSnapshot,
  verifyDocumentLinkSetSnapshot,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentPurgeProofResponse,
} from "@symcrypt/validators/response";
import { readCanonicalJson } from "../keyingCanonicalJson";
import { addBundleByHash, assertCanonicalEqual } from "./bundleVerification";
import {
  observeAccessManifestCheckpoints,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import { verifyDocumentManifestBundle } from "./documentProjectionVerification";
import { loadManifestCheckpointVerification } from "./manifestCheckpointVerification";
import { readAccessManifest } from "./readers";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

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

async function verifySignedPurgeDocumentManifestChain(input: {
  readonly checkpointContext: ProjectionCheckpointContext;
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
      bundle,
      bundlesByHash,
      checkpointContext: input.checkpointContext,
      containerPathByManifestHash: input.containerPathByManifestHash,
      enforceLocalCheckpoint: false,
      label: `Document purge predecessor[${index}]`,
      principalPolicyCache: input.principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      trustedPredecessorByHash,
      verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  }

  const head = await verifyDocumentManifestBundle({
    bundle: input.proof.documentManifest,
    bundlesByHash,
    checkpointContext: input.checkpointContext,
    containerPathByManifestHash: input.containerPathByManifestHash,
    enforceLocalCheckpoint: false,
    label: "Document purge manifest",
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    trustedPredecessorByHash,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: [head],
    verifiedManifests: [...verifiedByHash.values()],
  });
  return head;
}

export async function verifyPurgeDocumentManifest(input: {
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly enforceLocalCheckpoints: boolean;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedDocumentLinkSetManifest | VerifiedDocumentLinkSetSnapshot> {
  if (input.proof.documentManifestPredecessors.length > 0) {
    return verifySignedPurgeDocumentManifestChain({
      checkpointContext: input.checkpointContext,
      containerPathByManifestHash: input.containerPathByManifestHash,
      principalPolicyCache: input.principalPolicyCache,
      proof: input.proof,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
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
  observeAccessManifestCheckpoints(input.checkpointContext, {
    verifiedHeads: [documentManifest],
    verifiedManifests: [...verifiedByHash.values()],
  });
  return documentManifest;
}
