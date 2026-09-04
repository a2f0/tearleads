import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readCanonicalRecord } from "../keyingCanonicalJson";
import { readRecordNullableString } from "./readers";

/**
 * A container manifest pins the parent manifest it was created or moved
 * under, and successors inherit that pin, so the pin says nothing about the
 * ancestor heads a later grant, revoke, or rekey was actually authorized
 * under. Those heads are in the event: every container event signs the
 * manifest hashes of the path it was committed against, and the API refuses
 * an event whose citations are not the current heads at commit time. So a
 * head's authorization path is rebuilt here from its citations, root to
 * parent, and the signer is checked against those heads rather than against
 * the stale creation-time pin.
 *
 * Two further rules mirror the principal-policy external-authority rules. A
 * head that is new to this device (its epoch is beyond the device's local
 * checkpoint for the container) must cite the ancestor heads the projection
 * serves as current, exactly as a post-checkpoint policy successor must cite
 * the current authority head. And a head must not cite an older parent head
 * than the manifest before it did, so an ancestor head an earlier child event
 * already saw can never be rolled back for a later one. A device with no
 * checkpoint on the container cannot order the child event against an
 * ancestor change and accepts the cited history, as it does for policies.
 */

export interface CitedAncestorResolutionInput {
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
  readonly verifyHistoryBundle: (
    bundle: AccessManifestBundleWireResponse,
    label: string,
  ) => Promise<VerifiedContainerAccessManifest>;
}

function bundleContainerId(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): string | null {
  return readRecordNullableString(
    readCanonicalRecord(bundle.state, `${label} state`),
    "containerId",
    `${label} state`,
  );
}

function citedContainerId(
  input: CitedAncestorResolutionInput,
  manifestHash: string,
): string | null {
  const verified = input.verifiedByHash.get(manifestHash);
  if (verified) return verified.state.containerId;
  const bundle = input.bundlesByHash.get(manifestHash);
  return bundle ? bundleContainerId(bundle, input.label) : null;
}

function citedManifestHashForContainer(
  input: CitedAncestorResolutionInput,
  cited: readonly string[],
  containerId: string,
): string {
  const hashes = cited.filter(
    (manifestHash) => citedContainerId(input, manifestHash) === containerId,
  );
  const [manifestHash] = hashes;
  if (manifestHash === undefined) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} does not cite a served head of its parent container ${containerId}`,
    );
  }
  if (hashes.length > 1) {
    throw new KeyingVerificationError(
      "duplicate_entry",
      `${input.label} cites more than one head of container ${containerId}`,
    );
  }
  return manifestHash;
}

async function resolveCitedManifest(
  input: CitedAncestorResolutionInput,
  manifestHash: string,
  containerId: string,
): Promise<VerifiedContainerAccessManifest> {
  const verified = input.verifiedByHash.get(manifestHash);
  if (verified) return verified;
  const bundle = input.bundlesByHash.get(manifestHash);
  if (!bundle) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} cites a head of container ${containerId} that the projection does not serve`,
    );
  }
  return input.verifyHistoryBundle(
    bundle,
    `${input.label} cited ancestor ${containerId}`,
  );
}

/**
 * The ancestor path, root first, that a container event cites, ending at the
 * head of `parentContainerId`. Empty for a root container.
 */
export async function resolveCitedAncestorPath(
  input: CitedAncestorResolutionInput & {
    readonly event: VerifiedAccessEvent;
    readonly parentContainerId: string | null;
  },
): Promise<VerifiedContainerAccessManifest[]> {
  const cited = input.event.event.dependencyManifestHashes;
  const chain: VerifiedContainerAccessManifest[] = [];
  const seen = new Set<string>();
  let containerId = input.parentContainerId;
  while (containerId !== null) {
    if (seen.has(containerId)) {
      throw new KeyingVerificationError(
        "object_mismatch",
        `${input.label} cited ancestors form a cycle at ${containerId}`,
      );
    }
    seen.add(containerId);
    const ancestor = await resolveCitedManifest(
      input,
      citedManifestHashForContainer(input, cited, containerId),
      containerId,
    );
    chain.unshift(ancestor);
    containerId = ancestor.state.parentContainerId;
  }
  return chain;
}

/**
 * A head beyond the device's local checkpoint must cite the ancestor heads
 * the projection serves as current.
 */
export function assertNewHeadCitesCurrentAncestors(input: {
  readonly citedAncestors: readonly VerifiedContainerAccessManifest[];
  readonly label: string;
  readonly localCheckpoint: AccessManifestCheckpoint | null;
  readonly servedAncestors: readonly VerifiedContainerAccessManifest[];
  readonly state: { readonly epoch: number };
}): void {
  if (
    !input.localCheckpoint ||
    input.state.epoch <= input.localCheckpoint.epoch
  ) {
    return;
  }
  for (const ancestor of input.citedAncestors) {
    if (
      !input.servedAncestors.some(
        (served) => served.manifestHash === ancestor.manifestHash,
      )
    ) {
      throw new KeyingVerificationError(
        "rollback",
        `${input.label} is new to this device but cites a head of container ${ancestor.state.containerId} that is no longer current`,
      );
    }
  }
}

/**
 * A head must not cite an older head of its parent than the manifest before
 * it cited. Skipped when the parent changed (a move) or the previous
 * manifest's own citation cannot be resolved from the served bundles.
 */
export function assertCitedParentDoesNotRegress(
  input: CitedAncestorResolutionInput & {
    readonly citedAncestors: readonly VerifiedContainerAccessManifest[];
    readonly previousManifest: VerifiedContainerAccessManifest | null;
  },
): void {
  const parent = input.citedAncestors.at(-1);
  const previous = input.previousManifest;
  if (
    !parent ||
    !previous ||
    previous.state.parentContainerId !== parent.state.containerId
  ) {
    return;
  }
  const previousParentHash = previous.event.event.dependencyManifestHashes.find(
    (manifestHash) =>
      citedContainerId(input, manifestHash) === parent.state.containerId,
  );
  const previousParent =
    previousParentHash === undefined
      ? undefined
      : input.verifiedByHash.get(previousParentHash);
  if (previousParent && parent.state.epoch < previousParent.state.epoch) {
    throw new KeyingVerificationError(
      "rollback",
      `${input.label} cites an older head of container ${parent.state.containerId} than its previous manifest cited`,
    );
  }
}
