import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readCanonicalRecord } from "../keyingCanonicalJson";
import type { ExecSql } from "../sqlite/sqlSchema";
import { isKeyingVerificationError } from "./error";
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
 * also cite the ancestor heads the projection serves as current, or be signed
 * by a member who still holds the authority the event needs at them: the
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
 * The served ancestors a head cites at a stale head, by container id. A
 * served head equal to the cited one is current; one that descends from it
 * is the ambiguous ordering; one that does not is a stale or forked ancestor
 * head, whatever the server calls current, since the signed event proves the
 * cited head exists.
 */
function staleAncestorCitations(input: {
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly servedAncestors: readonly VerifiedContainerAccessManifest[];
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): string[] {
  const citations = input.head.event.event.dependencyManifestHashes;
  const stale: string[] = [];
  for (const served of input.servedAncestors) {
    const containerId = served.state.containerId;
    const cited = verifiedCitedHead(
      input.verifiedByHash,
      citations,
      containerId,
    );
    // An ancestor the head does not cite at all joined the path after the
    // head was signed, when an ancestor between them moved: the head is as
    // stale toward it as toward an advanced one.
    if (!cited) {
      stale.push(containerId);
      continue;
    }
    if (cited.manifestHash === served.manifestHash) continue;
    if (!descendsFrom(input.verifiedByHash, served, cited)) {
      throw new KeyingVerificationError(
        "rollback",
        `${input.label} cites a head of ancestor container ${containerId} that the served current head does not descend from`,
      );
    }
    stale.push(containerId);
  }
  return stale;
}

/**
 * The source ancestors a move cites at a head older than this device's own
 * checkpoint for that container. The projection serves the destination path,
 * not the source's current heads, so the device's checkpoints stand in for
 * them; a device with none for a source ancestor is at first contact with it.
 */
async function staleMoveSourceCitations(input: {
  readonly execSql: ExecSql;
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly localCheckpoints: Map<string, AccessManifestCheckpoint | null>;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): Promise<string[]> {
  const previousHash = input.head.state.previousManifestHash;
  const previous =
    previousHash === null ? undefined : input.verifiedByHash.get(previousHash);
  if (!previous) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} previous manifest is not verified`,
    );
  }
  const citations = input.head.event.event.dependencyManifestHashes;
  const stale: string[] = [];
  let containerId = previous.state.parentContainerId;
  while (containerId !== null) {
    const cited = verifiedCitedHead(
      input.verifiedByHash,
      citations,
      containerId,
    );
    if (!cited) break;
    const localCheckpoint = await loadLocalAccessManifestCheckpoint({
      execSql: input.execSql,
      localCheckpoints: input.localCheckpoints,
      objectId: containerId,
      objectKind: "container",
      organizationId: cited.state.organizationId,
    });
    if (localCheckpoint && cited.state.epoch < localCheckpoint.epoch) {
      stale.push(containerId);
    }
    containerId = cited.state.parentContainerId;
  }
  return stale;
}

/**
 * A served head newer than this device's checkpoint for its container must
 * cite, for every ancestor, the head the projection serves as current, or be
 * signed by a member who still holds the authority the event needs at the
 * served current path: the container form of the principal-policy rule that
 * a successor new to a device must cite the authority's current head. A
 * member revoked from an ancestor could otherwise commit a child event citing
 * the ancestor head that still granted them, and a device already holding
 * the child would take it for a stale delivery; a member with current
 * authority gains nothing by citing an older head, so their late event is
 * accepted as the stale delivery it is. The rule reads the served heads, so
 * it composes with the ancestor's own checkpoint; a device with no checkpoint
 * for the child is at first contact with it and takes the served history as
 * it is, as it does for principal policies.
 *
 * A move takes its admin authority from the source ancestors, which the
 * projection does not serve, so their cited heads are held to this device's
 * own checkpoints for them instead, with no authority to re-check.
 *
 * What remains refused, as `stale_citation`, is a head by a member since
 * revoked at an ancestor. Only the head is held to this, not the history
 * between the checkpoint and it, so a later event on the container by a
 * member with current authority supersedes the refused head and verifies it
 * as a predecessor. The refusing device cannot commit that event itself,
 * since every mutation verifies this projection first; sync records the
 * refusal and defers the container rather than failing it.
 */
export async function assertNewHeadCitesServedAncestors(input: {
  // Re-checks the head's signer at the served current path. Called only
  // when the head cites a stale ancestor head; throws `unauthorized` when
  // the signer holds no authority there.
  readonly authorizeAtServedPath: () => Promise<void>;
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
  if (input.head.event.event.eventType === "container.move") {
    const staleSource = await staleMoveSourceCitations(input);
    if (staleSource.length > 0) {
      throw new KeyingVerificationError(
        "stale_citation",
        `${input.label} is newer than the local checkpoint and cites a head of source ancestor container ${staleSource.join(", ")} older than this device's checkpoint for it; a later event on the container by a member with current authority supersedes it`,
      );
    }
  }
  const stale = staleAncestorCitations(input);
  if (stale.length === 0) return;
  try {
    await input.authorizeAtServedPath();
  } catch (error) {
    if (!isKeyingVerificationError(error) || error.code !== "unauthorized") {
      throw error;
    }
    throw new KeyingVerificationError(
      "stale_citation",
      `${input.label} is newer than the local checkpoint, cites a stale head of ancestor container ${stale.join(", ")} rather than the served current head, and its signer holds no authority at the served current path; a later event on the container by a member with current authority supersedes it`,
    );
  }
}
