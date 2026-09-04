import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { ExecSql } from "../sqlite/sqlSchema";
import { descendsFrom, verifiedCitedHead } from "./containerAncestorCitations";
import { isKeyingVerificationError } from "./error";
import { loadLocalAccessManifestCheckpoint } from "./manifestCheckpointVerification";

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
    const cited = verifiedCitedHead({
      cited: citations,
      containerId,
      label: input.label,
      verifiedByHash: input.verifiedByHash,
    });
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
 * Whether a cited source head is the head this device checkpointed for the
 * container or descends from it. Epochs alone would let a same-epoch fork
 * signed under an older head pass; the predecessor chain down to the
 * checkpointed epoch is served with the citation and fully verified, so the
 * hash at that epoch settles it.
 */
function assertCitedHeadReachesCheckpoint(input: {
  readonly cited: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly localCheckpoint: AccessManifestCheckpoint;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  const containerId = input.cited.state.containerId;
  let current: VerifiedContainerAccessManifest | undefined = input.cited;
  while (current && current.state.epoch > input.localCheckpoint.epoch) {
    const previousHash: string | null = current.state.previousManifestHash;
    current =
      previousHash === null
        ? undefined
        : input.verifiedByHash.get(previousHash);
  }
  if (!current || current.state.epoch !== input.localCheckpoint.epoch) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} cites a head of source ancestor container ${containerId} whose history down to this device's checkpoint is not served`,
    );
  }
  if (current.manifestHash !== input.localCheckpoint.manifestHash) {
    throw new KeyingVerificationError(
      "equivocation",
      `${input.label} cites a head of source ancestor container ${containerId} that forks the head this device checkpointed`,
    );
  }
}

/**
 * The source ancestors a move cites at a head older than this device's own
 * checkpoint for that container. The projection serves the destination path,
 * not the source's current heads, so the device's checkpoints stand in for
 * them; a device with none for a source ancestor is at first contact with it.
 * A cited head at or past the checkpoint must be or descend from it.
 */
async function staleMoveSourceCitations(input: {
  readonly execSql: ExecSql;
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
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
  const seen = new Set<string>();
  let containerId = previous.state.parentContainerId;
  while (containerId !== null && !seen.has(containerId)) {
    seen.add(containerId);
    const cited = verifiedCitedHead({
      cited: citations,
      containerId,
      label: input.label,
      verifiedByHash: input.verifiedByHash,
    });
    if (!cited) {
      // The cited ancestor path already resolved the whole source chain.
      throw new KeyingVerificationError(
        "missing_dependency",
        `${input.label} does not cite a verified head of source ancestor container ${containerId}`,
      );
    }
    const localCheckpoint = await loadLocalAccessManifestCheckpoint({
      execSql: input.execSql,
      objectId: containerId,
      objectKind: "container",
      organizationId: input.head.state.organizationId,
    });
    if (localCheckpoint) {
      if (cited.state.epoch < localCheckpoint.epoch) {
        stale.push(containerId);
      } else {
        assertCitedHeadReachesCheckpoint({
          cited,
          label: input.label,
          localCheckpoint,
          verifiedByHash: input.verifiedByHash,
        });
      }
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
 * accepted as the stale delivery it is. That authority is read from the
 * served ancestors and the container's own state as this device last
 * accepted it, never from the unheld history between the checkpoint and
 * the head, which the same member could have written. The rule reads the
 * served heads, so it composes with the ancestor's own checkpoint; a device
 * with no checkpoint for the child is at first contact with it and takes the
 * served history as it is, as it does for principal policies.
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
  // Re-checks the head's signer at the served current path above the
  // container's state as this device last accepted it, the manifest at the
  // given checkpoint. Called only when the head cites a stale ancestor head;
  // throws `unauthorized` when the signer holds no authority there.
  readonly authorizeAtServedPath: (
    localCheckpoint: AccessManifestCheckpoint,
  ) => Promise<void>;
  readonly execSql: ExecSql;
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly servedAncestors: readonly VerifiedContainerAccessManifest[];
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): Promise<void> {
  if (input.servedAncestors.length === 0) return;
  // Read the checkpoint fresh rather than from the pass's cache: the atomic
  // advance re-validates checkpoint order, not this rule, so a checkpoint a
  // concurrent pass commits must be seen here, at the cost of one read.
  const localCheckpoint = await loadLocalAccessManifestCheckpoint({
    execSql: input.execSql,
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
    await input.authorizeAtServedPath(localCheckpoint);
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
