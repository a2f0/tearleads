import type {
  ContainerKeyWrap,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { computeContainerKeyEpochHash } from "@tearleads/crypto";
import type { HistoricalContainerKekResponse } from "@tearleads/validators/response";
import {
  listContainerKeyEpochs,
  listContainerKeyWraps,
} from "../../../access/read/containerKekStore";
import { loadContainerManifestBundleByHash } from "./accessPaths";
import {
  principalPolicyReferenceCacheKey,
  verifiedPrincipalPolicyStateReferenceCacheKey,
} from "./principalPolicies";
import {
  containerKeyWrapRecord,
  stripContainerKeyEpoch,
  stripContainerKeyWrap,
  toVerifiedContainerManifest,
} from "./records";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "./types";

/**
 * Reference keys of every verified principal policy state — current head or
 * history entry — whose membership projection includes the requesting user.
 * Historical epochs pin principal audiences to these exact states, so a user
 * added to a group later (a later policy version) matches none of the pinned
 * states and fails closed.
 */
function requesterMemberPolicyStateKeys(
  userId: string,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): ReadonlySet<string> {
  const isMember = (
    projection: readonly VerifiedPrincipalPolicy["projection"][number][],
  ): boolean =>
    projection.some(
      (member) =>
        member.memberPrincipalType === "user" &&
        member.memberPrincipalId === userId,
    );

  const keys = new Set<string>();
  for (const policy of principalPolicies) {
    if (isMember(policy.projection)) {
      keys.add(verifiedPrincipalPolicyStateReferenceCacheKey(policy.state));
    }
    for (const entry of policy.history ?? []) {
      if (isMember(entry.projection)) {
        keys.add(verifiedPrincipalPolicyStateReferenceCacheKey(entry.state));
      }
    }
  }
  return keys;
}

interface ContainerManifestLineage {
  /** Key-epoch ids referenced by the verified previous-manifest chain. */
  readonly epochIds: ReadonlySet<string>;
  /**
   * For each lineage epoch, the principal heads pinned by the manifests
   * under which that epoch was current — its principal audience proof.
   */
  readonly principalHeadsByEpochId: ReadonlyMap<
    string,
    readonly ReferencedPrincipalHead[]
  >;
}

/**
 * Walks the container's own manifest lineage backwards from the current
 * manifest, collecting which key epochs the verified chain actually
 * references and which principal heads each manifest pinned. Epoch rows
 * outside this chain (forked or unreferenced) are never served historically.
 */
async function loadContainerManifestLineage(
  context: ContainerWriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
): Promise<ContainerManifestLineage> {
  const containerId = manifest.state.containerId;
  const epochIds = new Set<string>();
  const principalHeadsByEpochId = new Map<string, ReferencedPrincipalHead[]>();
  const visitedHashes = new Set<string>();

  const record = (entry: VerifiedContainerAccessManifest): void => {
    const epochId = entry.state.containerKeyEpochId;
    if (!epochId) {
      return;
    }
    epochIds.add(epochId);
    let heads = principalHeadsByEpochId.get(epochId);
    if (!heads) {
      heads = [];
      principalHeadsByEpochId.set(epochId, heads);
    }
    heads.push(...entry.state.referencedPrincipalHeads);
  };

  record(manifest);
  visitedHashes.add(manifest.manifestHash);
  let previousManifestHash = manifest.manifest.previousManifestHash;
  while (previousManifestHash && !visitedHashes.has(previousManifestHash)) {
    visitedHashes.add(previousManifestHash);
    const bundle = await loadContainerManifestBundleByHash(
      context,
      previousManifestHash,
    );
    const verified = toVerifiedContainerManifest(bundle);
    if (verified.state.containerId !== containerId) {
      throw new ContainerWriterProjectionError(
        "Container manifest lineage is inconsistent",
        409,
      );
    }
    record(verified);
    previousManifestHash = verified.manifest.previousManifestHash;
  }

  return { epochIds, principalHeadsByEpochId };
}

function historicalWrapAdmitted(input: {
  readonly epochPrincipalHeads: readonly ReferencedPrincipalHead[];
  readonly pathContainerKeyEpochIds: ReadonlyMap<string, string>;
  readonly requesterPolicyStateKeys: ReadonlySet<string>;
  readonly userId: string;
  readonly wrap: ContainerKeyWrap;
}): boolean {
  const { wrap } = input;
  if (wrap.recipientKind === "user") {
    return wrap.recipientId === input.userId;
  }
  if (wrap.recipientKind === "container") {
    // Only a SUPERSEDED parent epoch may be targeted. Every current member
    // (including one granted access after this epoch's rotation) holds the
    // parent's current epoch, so serving a wrap to it would disclose
    // pre-grant key material; a superseded parent epoch is only reachable
    // through the requester's own filtered historical wraps.
    const recipientCurrentEpochId = input.pathContainerKeyEpochIds.get(
      wrap.recipientId,
    );
    return (
      recipientCurrentEpochId !== undefined &&
      recipientCurrentEpochId !== wrap.recipientKeyEpochId
    );
  }
  // Principal wraps require membership at a policy state the epoch's own
  // manifests pinned — current membership proves nothing about the past.
  return input.epochPrincipalHeads.some(
    (principalHead) =>
      principalHead.principalId === wrap.recipientId &&
      input.requesterPolicyStateKeys.has(
        principalPolicyReferenceCacheKey(principalHead),
      ),
  );
}

/**
 * Superseded key epochs for one container, limited to epochs the verified
 * manifest lineage references, with wraps filtered to recipients whose key
 * material proves the REQUESTER was in the epoch's audience: the user
 * directly, principals whose pinned historical policy state lists them, or
 * path containers at a superseded parent epoch. Epochs whose filtered wrap
 * set is empty are omitted — a member added after a rotation simply receives
 * nothing from before their time. Clients re-verify every unwrap against the
 * epoch id's key-material commitment.
 */
export async function loadHistoricalContainerKeks(input: {
  readonly context: ContainerWriterProjectionContext;
  readonly manifest: VerifiedContainerAccessManifest;
  /** Current key-epoch id of every container on the requested path. */
  readonly pathContainerKeyEpochIds: ReadonlyMap<string, string>;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly userId: string;
}): Promise<HistoricalContainerKekResponse[]> {
  const containerId = input.manifest.state.containerId;
  const currentEpochId = input.manifest.state.containerKeyEpochId;
  const epochs = await listContainerKeyEpochs(
    containerId,
    input.context.executor,
  );
  const lineage = await loadContainerManifestLineage(
    input.context,
    input.manifest,
  );
  const requesterPolicyStateKeys = requesterMemberPolicyStateKeys(
    input.userId,
    input.principalPolicies,
  );
  const historicalKeks: HistoricalContainerKekResponse[] = [];

  for (const epoch of epochs) {
    if (epoch.id === currentEpochId || !lineage.epochIds.has(epoch.id)) {
      continue;
    }
    const epochPrincipalHeads =
      lineage.principalHeadsByEpochId.get(epoch.id) ?? [];
    const wraps = (
      await listContainerKeyWraps(epoch.id, input.context.executor)
    ).filter((wrap) =>
      historicalWrapAdmitted({
        epochPrincipalHeads,
        pathContainerKeyEpochIds: input.pathContainerKeyEpochIds,
        requesterPolicyStateKeys,
        userId: input.userId,
        wrap,
      }),
    );
    if (wraps.length === 0) {
      continue;
    }

    const keyEpoch = stripContainerKeyEpoch(epoch);
    historicalKeks.push({
      accessManifestHash: epoch.accessManifestHash,
      containerId,
      containerKeyEpoch: epoch.keyEpoch,
      containerKeyEpochId: epoch.id,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      parentContainerKeyEpochId: epoch.parentContainerKeyEpochId,
      wraps: wraps
        .map(stripContainerKeyWrap)
        .map((wrap) => containerKeyWrapRecord(wrap)),
    });
  }

  return historicalKeks;
}
