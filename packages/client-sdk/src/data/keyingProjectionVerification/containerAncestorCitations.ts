import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readCanonicalRecord } from "../keyingCanonicalJson";
import type { ExecSql } from "../sqlite/sqlSchema";
import { loadLocalAccessManifestCheckpoint } from "./manifestCheckpointVerification";
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

/** The verified head of `containerId` among the cited hashes, if any. */
function verifiedCitedHead(
  verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>,
  cited: readonly string[],
  containerId: string,
): VerifiedContainerAccessManifest | undefined {
  for (const manifestHash of cited) {
    const verified = verifiedByHash.get(manifestHash);
    if (verified?.state.containerId === containerId) return verified;
  }
  return undefined;
}

/**
 * Whether `head` is `floor` or descends from it through verified
 * predecessors. Epochs alone would let a same-epoch fork signed under an
 * older head pass; lineage cannot be forged without the chain. Every
 * predecessor of a verified manifest was verified with it, so a hop that is
 * not in the verified set means the chain was not served.
 */
function descendsFrom(
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
      verifiedCitedHead(input.verifiedByHash, previousCited, containerId),
      ...(citedChild
        ? [
            input.verifiedByHash.get(citedChild.state.parentManifestHash ?? ""),
            verifiedCitedHead(
              input.verifiedByHash,
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
 * member revoked from an ancestor could otherwise commit a child event citing
 * the ancestor head that still granted them, and a device already holding
 * the child would take it for a stale delivery. The rule reads the served
 * heads, so it composes with the ancestor's own checkpoint; a device with no
 * checkpoint for the child is at first contact with it and takes the served
 * history as it is, as it does for principal policies.
 *
 * Only the head is held to this, not the history between the checkpoint and
 * it: a child head committed before an ancestor advanced and first seen after
 * is refused until any later child event cites the current heads, and that
 * event then verifies the refused head as its predecessor. The refusal is
 * `stale_citation`, its own code, because the device cannot tell that honest
 * ordering from a forgery and must simply wait: sync defers rather than
 * records an incident, and no fresh projection resolves it.
 *
 * The opposite disagreement is not that: the signed event proves the head it
 * cites exists, so a served ancestor head that does not descend from the
 * cited one is a stale or forked ancestor head, whatever the server calls
 * current, and stays a reportable rollback.
 */
export async function assertNewHeadCitesServedAncestors(input: {
  readonly execSql: ExecSql;
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly localCheckpoints: Map<string, AccessManifestCheckpoint | null>;
  readonly servedAncestors: readonly VerifiedContainerAccessManifest[];
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): Promise<void> {
  if (input.servedAncestors.length === 0) return;
  const localCheckpoint = await loadLocalAccessManifestCheckpoint({
    execSql: input.execSql,
    localCheckpoints: input.localCheckpoints,
    objectId: input.head.state.containerId,
    objectKind: "container",
    organizationId: input.head.state.organizationId,
  });
  if (!localCheckpoint || input.head.state.epoch <= localCheckpoint.epoch) {
    return;
  }
  const citations = input.head.event.event.dependencyManifestHashes;
  for (const served of input.servedAncestors) {
    const containerId = served.state.containerId;
    const cited = verifiedCitedHead(
      input.verifiedByHash,
      citations,
      containerId,
    );
    if (!cited) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `${input.label} does not cite a verified head of ancestor container ${containerId}`,
      );
    }
    if (cited.manifestHash === served.manifestHash) continue;
    if (descendsFrom(input.verifiedByHash, served, cited)) {
      throw new KeyingVerificationError(
        "stale_citation",
        `${input.label} is newer than the local checkpoint but cites a stale head of ancestor container ${containerId} rather than the served current head; a later event on the container that cites the current heads supersedes it`,
      );
    }
    throw new KeyingVerificationError(
      "rollback",
      `${input.label} cites a head of ancestor container ${containerId} that the served current head does not descend from`,
    );
  }
}
