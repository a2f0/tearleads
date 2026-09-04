import {
  KeyingVerificationError,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readCanonicalRecord } from "../keyingCanonicalJson";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
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
 * also cite the ancestor heads the projection serves as current: the
 * container form of the principal-policy rule that a successor new to a
 * device must cite the authority's current head.
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

function verifiedCitedHead(
  input: CitedLineageInput,
  cited: readonly string[],
  containerId: string,
): VerifiedContainerAccessManifest | undefined {
  const manifestHash = cited.find(
    (candidate) => citedContainerId(input, candidate) === containerId,
  );
  return manifestHash === undefined
    ? undefined
    : input.verifiedByHash.get(manifestHash);
}

/**
 * The cited head must be the established head or descend from it through
 * verified predecessors. Epochs alone would let a same-epoch fork signed
 * under an older head pass; lineage cannot be forged without the chain.
 * Every predecessor of a verified manifest was verified with it, so a hop
 * that is not in the verified set means the chain was not served.
 */
function assertCitedHeadDescendsFrom(
  input: CitedLineageInput,
  cited: VerifiedContainerAccessManifest,
  floor: VerifiedContainerAccessManifest,
): void {
  const containerId = cited.state.containerId;
  let current: VerifiedContainerAccessManifest | undefined = cited;
  while (current && current.state.epoch >= floor.state.epoch) {
    if (current.manifestHash === floor.manifestHash) return;
    const previousHash: string | null = current.state.previousManifestHash;
    current =
      previousHash === null
        ? undefined
        : input.verifiedByHash.get(previousHash);
  }
  throw new KeyingVerificationError(
    "rollback",
    `${input.label} cites a head of container ${containerId} that does not descend from the head an earlier signed statement already proved current`,
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
      verifiedCitedHead(input, previousCited, containerId),
      ...(citedChild
        ? [
            input.verifiedByHash.get(citedChild.state.parentManifestHash ?? ""),
            verifiedCitedHead(
              input,
              citedChild.event.event.dependencyManifestHashes,
              containerId,
            ),
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

/**
 * A served head newer than this device's checkpoint for its container must
 * cite, for every ancestor, the head the projection serves as current. A
 * member revoked from an ancestor could otherwise, with a server that still
 * presents the older ancestor head as current, commit a child event that a
 * device already holding the child would take for a stale delivery. A device
 * with no checkpoint is at first contact and takes the served history as it
 * is, as it does for principal policies.
 *
 * Only the head is held to this, not the history between the checkpoint and
 * it: a child head committed before an ancestor advanced and first seen after
 * is refused until any later child event cites the current heads, and that
 * event then verifies the refused head as its predecessor.
 */
export async function assertNewHeadCitesServedAncestors(input: {
  readonly execSql: ExecSql;
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly servedAncestors: readonly VerifiedContainerAccessManifest[];
}): Promise<void> {
  if (input.servedAncestors.length === 0) return;
  const localCheckpoint = await loadAccessManifestCheckpoint(
    input.execSql,
    "container",
    input.head.state.organizationId,
    input.head.state.containerId,
  );
  if (!localCheckpoint || input.head.state.epoch <= localCheckpoint.epoch) {
    return;
  }
  const cited = new Set(input.head.event.event.dependencyManifestHashes);
  for (const ancestor of input.servedAncestors) {
    if (!cited.has(ancestor.manifestHash)) {
      throw new KeyingVerificationError(
        "rollback",
        `${input.label} is newer than the local checkpoint but cites a stale head of ancestor container ${ancestor.state.containerId} rather than the served current head`,
      );
    }
  }
}
