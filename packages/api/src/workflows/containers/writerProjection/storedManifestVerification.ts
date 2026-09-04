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
import {
  loadPrincipalAuthorizationPoliciesForReferences,
  PrincipalPolicyProjectionError,
} from "../../principals/principalPolicyProjection";
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

export function clearStoredContainerManifestVerificationCache(): void {
  verifiedStoredManifests.clear();
}

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

function verifyHistoricalContainerManifest(
  input: Parameters<typeof verifyContainerAccessManifest>[0],
) {
  return verifyContainerAccessManifest({
    ...input,
    authorizationMembership: "referenced",
  });
}

/**
 * The manifests a stored event cites, verified and indexed by container. An
 * event was authorized against the heads current when it was committed, and
 * it signs exactly those as its dependencies (assertAccessEventDependencies
 * checks the set), so they, not the creation-time pins the manifest carries,
 * are the paths to re-verify it against. One head per container: the paths a
 * mutation submits are all current, so they cannot disagree on a container.
 */
async function loadCitedManifestsByContainer(input: {
  readonly parsed: VerifiedContainerAccessManifest;
  readonly verifyHash: (
    manifestHash: string,
  ) => Promise<VerifiedContainerAccessManifest>;
}): Promise<ReadonlyMap<string, VerifiedContainerAccessManifest>> {
  const byContainer = new Map<string, VerifiedContainerAccessManifest>();
  for (const manifestHash of input.parsed.event.event
    .dependencyManifestHashes) {
    const cited = await input.verifyHash(manifestHash);
    if (byContainer.has(cited.state.containerId)) {
      throw integrityError("access event cites two heads of one container");
    }
    byContainer.set(cited.state.containerId, cited);
  }
  return byContainer;
}

/** The cited ancestor chain, root first, ending at `parentContainerId`. */
function citedAncestorPath(
  cited: ReadonlyMap<string, VerifiedContainerAccessManifest>,
  parentContainerId: string | null,
): VerifiedContainerAccessManifest[] {
  const reversed: VerifiedContainerAccessManifest[] = [];
  let containerId = parentContainerId;
  while (containerId !== null) {
    if (reversed.length >= MAX_CONTAINER_PATH_DEPTH) {
      throw integrityError("container path exceeds maximum depth");
    }
    const ancestor = cited.get(containerId);
    if (!ancestor) {
      throw integrityError(
        `access event does not cite a head of ancestor container ${containerId}`,
      );
    }
    reversed.push(ancestor);
    containerId = ancestor.state.parentContainerId;
  }
  return reversed.reverse();
}

async function loadStoredManifestArtifacts(input: {
  readonly parsed: VerifiedContainerAccessManifest;
  readonly verifyHash: (
    manifestHash: string,
  ) => Promise<VerifiedContainerAccessManifest>;
}): Promise<StoredManifestArtifacts> {
  const { parsed } = input;
  const eventType = parsed.event.event.eventType;
  const previousManifest = parsed.state.previousManifestHash
    ? await input.verifyHash(parsed.state.previousManifestHash)
    : null;
  const cited = await loadCitedManifestsByContainer(input);
  // A create's parent path and a move's destination path end at the parent
  // the signed body pins; the crypto verifier holds that last element to the
  // pin. The path above the mutated container is the one its event cites.
  return {
    previousManifest,
    previousPath: previousManifest
      ? [
          ...citedAncestorPath(cited, previousManifest.state.parentContainerId),
          previousManifest,
        ]
      : undefined,
    parentPath:
      eventType === "container.create"
        ? citedAncestorPath(cited, parsed.state.parentContainerId)
        : undefined,
    destinationParentPath:
      eventType === "container.move"
        ? citedAncestorPath(cited, parsed.state.parentContainerId)
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
    const principalPolicies =
      await loadPrincipalAuthorizationPoliciesForReferences(
        input.context.executor,
        collectPrincipalReferences(parsed, [
          artifacts.previousPath,
          artifacts.parentPath,
          artifacts.destinationParentPath,
        ]),
        input.context.principalPolicyAuthorizationEvidence,
      );
    const verification = await verifyHistoricalContainerManifest({
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
  try {
    return await verifyBundle(input, input.bundle, new Set());
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      throw error;
    }
    if (error instanceof PrincipalPolicyProjectionError) {
      throw integrityError(error.message);
    }
    throw error;
  }
}
