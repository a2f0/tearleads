import {
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
 * whatever path the server pairs with the manifest.
 *
 * A head must also cite, for every ancestor, a head that is or descends from
 * the head an earlier signed statement already established, so an ancestor
 * head one signed statement established can never be rolled back or forked
 * away for a later one.
 *
 * A served head newer than this device's checkpoint for its container must
 * also cite the ancestor heads the projection serves as current, or be signed
 * by a member who still holds the authority the event needs at them: the
 * container form of the principal-policy rule that a successor new to a
 * device must cite the authority's current head. That rule lives in
 * containerAncestorCurrency.ts and builds on the helpers here.
 */

interface CitedAncestorResolutionInput {
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
  input: CitedLineageInput,
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

/** What the lineage rules read: the served and the verified bundles. */
export type CitedLineageInput = Pick<
  CitedAncestorResolutionInput,
  "bundlesByHash" | "label" | "verifiedByHash"
>;

/**
 * The verified head of `containerId` among the cited hashes, if any. Reads
 * verified manifests only: a cited hash the pass has not verified is not a
 * head to reason about, and every caller runs after the cited ancestor path
 * resolved and verified the chain. An event cites one head per container,
 * so a second verified one is a served citation set that was tampered with,
 * not a choice to make.
 */
export function verifiedCitedHead(input: {
  readonly cited: readonly string[];
  readonly containerId: string;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): VerifiedContainerAccessManifest | undefined {
  let found: VerifiedContainerAccessManifest | undefined;
  for (const manifestHash of input.cited) {
    const verified = input.verifiedByHash.get(manifestHash);
    if (verified?.state.containerId !== input.containerId) continue;
    if (found && found.manifestHash !== verified.manifestHash) {
      throw new KeyingVerificationError(
        "duplicate_entry",
        `${input.label} cites more than one head of container ${input.containerId}`,
      );
    }
    found = verified;
  }
  return found;
}

/**
 * Whether `head` is `floor` or descends from it through verified
 * predecessors. Epochs alone would let a same-epoch fork signed under an
 * older head pass; lineage cannot be forged without the chain. Every
 * predecessor of a verified manifest was verified with it, so a hop that is
 * not in the verified set means the chain was not served.
 */
export function descendsFrom(
  verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>,
  head: VerifiedContainerAccessManifest,
  floor: VerifiedContainerAccessManifest,
): boolean {
  let current: VerifiedContainerAccessManifest | undefined = head;
  while (current && current.state.epoch >= floor.state.epoch) {
    if (current.manifestHash === floor.manifestHash) return true;
    const previousHash: string | null = current.state.previousManifestHash;
    current =
      previousHash === null ? undefined : verifiedByHash.get(previousHash);
  }
  return false;
}

/** The cited head must be the established head or descend from it. */
function assertCitedHeadDescendsFrom(
  input: CitedLineageInput,
  cited: VerifiedContainerAccessManifest,
  floor: VerifiedContainerAccessManifest,
): void {
  if (descendsFrom(input.verifiedByHash, cited, floor)) return;
  throw new KeyingVerificationError(
    "rollback",
    `${input.label} cites a head of container ${cited.state.containerId} that does not descend from the head an earlier signed statement already proved current`,
  );
}

/**
 * A head must not cite a head of any ancestor that does not descend from the
 * head an earlier signed statement already established: the manifest before
 * it cited that ancestor, the previous manifest's own pin when this is its
 * parent, or a cited child of that ancestor was created or moved under it and
 * cited it. Ancestors no statement establishes are skipped.
 */
export function assertCitedAncestorsDoNotRegress(
  input: CitedLineageInput & {
    readonly citedAncestors: readonly VerifiedContainerAccessManifest[];
    readonly previousManifest: VerifiedContainerAccessManifest | null;
  },
): void {
  const previous = input.previousManifest;
  const previousCited = previous?.event.event.dependencyManifestHashes ?? [];
  input.citedAncestors.forEach((ancestor, index) => {
    const containerId = ancestor.state.containerId;
    const citedChild = input.citedAncestors[index + 1] ?? previous;
    const floors = [
      verifiedCitedHead({
        cited: previousCited,
        containerId,
        label: input.label,
        verifiedByHash: input.verifiedByHash,
      }),
      ...(citedChild
        ? [
            input.verifiedByHash.get(citedChild.state.parentManifestHash ?? ""),
            verifiedCitedHead({
              cited: citedChild.event.event.dependencyManifestHashes,
              containerId,
              label: input.label,
              verifiedByHash: input.verifiedByHash,
            }),
          ]
        : []),
    ];
    for (const floor of floors) {
      if (floor && floor.state.containerId === containerId) {
        assertCitedHeadDescendsFrom(input, ancestor, floor);
      }
    }
  });
}
