import type {
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  verifyContainerAccessManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { uniqueSortedStrings } from "../../../utils/array";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";
import { StoredVerificationCache } from "../../../utils/storedVerificationCache";
import { loadPrincipalPoliciesForReferences } from "../../principals/principalPolicyProjection";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { toVerifiedContainerManifest } from "./records";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "./types";

const MAX_CONTAINER_PATH_DEPTH = 100;
const MAX_CONTAINER_HISTORY_DEPTH = 4_096;
const verifiedStoredManifests =
  new StoredVerificationCache<VerifiedContainerAccessManifest>(2_048);

interface StoredManifestVerificationInput {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly context: ContainerWriterProjectionContext;
  readonly loadBundle: (
    manifestHash: string,
  ) => Promise<AccessManifestBundleWireResponse>;
}

interface StoredManifestArtifacts {
  readonly destinationParentPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly parentPath: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly previousPath: readonly VerifiedContainerAccessManifest[] | undefined;
}

function integrityError(message: string): ContainerWriterProjectionError {
  return new ContainerWriterProjectionError(
    `Stored container manifest failed integrity verification: ${message}`,
    409,
  );
}

function appendManifestHashes(
  hashes: string[],
  path: readonly VerifiedContainerAccessManifest[] | undefined,
): void {
  if (!path) {
    return;
  }
  for (const manifest of path) {
    hashes.push(manifest.manifestHash);
  }
}

function assertEventDependencies(input: {
  readonly destinationParentPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly event: VerifiedContainerAccessManifest["event"];
  readonly parentPath: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly previousPath: readonly VerifiedContainerAccessManifest[] | undefined;
}): void {
  const expected: string[] = [];
  if (input.event.event.eventType === "container.create") {
    appendManifestHashes(expected, input.parentPath);
  } else {
    if (input.previousManifest) {
      expected.push(input.previousManifest.manifestHash);
    }
    appendManifestHashes(expected, input.previousPath);
    if (input.event.event.eventType === "container.move") {
      appendManifestHashes(expected, input.destinationParentPath);
    }
  }

  const normalizedExpected = uniqueSortedStrings(expected);
  const actual = [...input.event.event.dependencyManifestHashes].sort();
  if (
    normalizedExpected.length !== actual.length ||
    normalizedExpected.some((hash, index) => hash !== actual[index])
  ) {
    throw integrityError("access event dependencies are inconsistent");
  }
}

function collectPrincipalReferences(
  manifest: VerifiedContainerAccessManifest,
  paths: readonly (readonly VerifiedContainerAccessManifest[] | undefined)[],
): ReferencedPrincipalHead[] {
  return [
    ...manifest.state.referencedPrincipalHeads,
    ...paths.flatMap((path) =>
      (path ?? []).flatMap((entry) => entry.state.referencedPrincipalHeads),
    ),
  ];
}

async function verifyStoredEvent(
  parsed: VerifiedContainerAccessManifest,
  signerPublicKey: Uint8Array,
): Promise<VerifiedAccessEvent> {
  const result = await verifySignedAccessEvent({
    body: parsed.event.body,
    event: parsed.event.event,
    signerPublicKey,
  });
  if (!result.ok) {
    throw integrityError(result.error.message);
  }
  if (result.value.eventHash !== parsed.event.eventHash) {
    throw integrityError("access event hash is inconsistent");
  }
  return result.value;
}

async function loadStoredEventSigner(
  input: StoredManifestVerificationInput,
  parsed: VerifiedContainerAccessManifest,
): Promise<Uint8Array> {
  return loadSignerPublicKey(input.context.executor, {
    error: () => integrityError("access event signer is inconsistent"),
    fingerprint: parsed.event.event.signerKeyFingerprint,
    userId: parsed.event.event.signerUserId,
  });
}

function storedVerificationSource(
  bundle: AccessManifestBundleWireResponse,
  signerPublicKey: Uint8Array,
) {
  return {
    bundle,
    signerPublicKey,
  };
}

async function loadStoredManifestArtifacts(input: {
  readonly parsed: VerifiedContainerAccessManifest;
  readonly verifyHash: (
    manifestHash: string,
  ) => Promise<VerifiedContainerAccessManifest>;
}): Promise<StoredManifestArtifacts> {
  const loadPath = async (
    manifestHash: string | null,
  ): Promise<VerifiedContainerAccessManifest[] | undefined> => {
    if (!manifestHash) {
      return;
    }
    const reversed: VerifiedContainerAccessManifest[] = [];
    let currentHash: string | null = manifestHash;
    while (currentHash) {
      if (reversed.length >= MAX_CONTAINER_PATH_DEPTH) {
        throw integrityError("container path exceeds maximum depth");
      }
      const current = await input.verifyHash(currentHash);
      reversed.push(current);
      currentHash = current.state.parentManifestHash;
    }
    return reversed.reverse();
  };

  const previousManifest = input.parsed.state.previousManifestHash
    ? await input.verifyHash(input.parsed.state.previousManifestHash)
    : null;
  return {
    previousManifest,
    previousPath: previousManifest
      ? await loadPath(previousManifest.manifestHash)
      : undefined,
    parentPath:
      input.parsed.event.event.eventType === "container.create"
        ? await loadPath(input.parsed.state.parentManifestHash)
        : undefined,
    destinationParentPath:
      input.parsed.event.event.eventType === "container.move"
        ? await loadPath(input.parsed.state.parentManifestHash)
        : undefined,
  };
}

async function verifyBundle(
  input: StoredManifestVerificationInput,
  bundle: AccessManifestBundleWireResponse,
  visiting: Set<string>,
): Promise<VerifiedContainerAccessManifest> {
  const cached = input.context.verifiedManifestByHash.get(bundle.manifestHash);
  if (cached) {
    return cached;
  }
  const parsed = toVerifiedContainerManifest(bundle);
  const signerPublicKey = await loadStoredEventSigner(input, parsed);
  const source = storedVerificationSource(bundle, signerPublicKey);
  const processCached = verifiedStoredManifests.get(
    bundle.manifestHash,
    source,
  );
  if (processCached) {
    input.context.verifiedManifestByHash.set(
      bundle.manifestHash,
      processCached,
    );
    return processCached;
  }
  if (visiting.has(bundle.manifestHash)) {
    throw integrityError("manifest history contains a cycle");
  }
  if (visiting.size >= MAX_CONTAINER_HISTORY_DEPTH) {
    throw integrityError("manifest history exceeds maximum depth");
  }
  visiting.add(bundle.manifestHash);
  try {
    const signedEvent = await verifyStoredEvent(parsed, signerPublicKey);
    const verifyHash = async (
      manifestHash: string,
    ): Promise<VerifiedContainerAccessManifest> =>
      verifyBundle(input, await input.loadBundle(manifestHash), visiting);
    const artifacts = await loadStoredManifestArtifacts({ parsed, verifyHash });
    const principalPolicies = await loadPrincipalPoliciesForReferences(
      input.context.executor,
      collectPrincipalReferences(parsed, [
        artifacts.previousPath,
        artifacts.parentPath,
        artifacts.destinationParentPath,
      ]),
    );
    const verification = await verifyContainerAccessManifest({
      event: signedEvent,
      expectedManifestHash: bundle.manifestHash,
      manifest: parsed.manifest,
      previousManifest: artifacts.previousManifest,
      principalPolicies,
      ...(artifacts.destinationParentPath !== undefined
        ? {
            destinationParentContainerPath: artifacts.destinationParentPath,
          }
        : {}),
      ...(artifacts.parentPath !== undefined
        ? { parentContainerPath: artifacts.parentPath }
        : {}),
      ...(artifacts.previousPath !== undefined
        ? { previousContainerPath: artifacts.previousPath }
        : {}),
    });
    if (!verification.ok) {
      throw integrityError(verification.error.message);
    }
    if (!canonicalJsonEquals(verification.value.state, parsed.state)) {
      throw integrityError("stored state does not match the signed transition");
    }
    assertEventDependencies({
      destinationParentPath: artifacts.destinationParentPath,
      event: verification.value.event,
      parentPath: artifacts.parentPath,
      previousManifest: artifacts.previousManifest,
      previousPath: artifacts.previousPath,
    });
    input.context.verifiedManifestByHash.set(
      bundle.manifestHash,
      verification.value,
    );
    verifiedStoredManifests.set(
      bundle.manifestHash,
      source,
      verification.value,
    );
    return verification.value;
  } finally {
    visiting.delete(bundle.manifestHash);
  }
}

export async function verifyStoredContainerManifest(
  input: StoredManifestVerificationInput,
): Promise<VerifiedContainerAccessManifest> {
  return verifyBundle(input, input.bundle, new Set());
}
