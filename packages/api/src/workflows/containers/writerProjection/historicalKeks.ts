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
import { loadPrincipalPolicyForReferencedHead } from "../../principals/principalPolicyProjection";
import { loadContainerManifestBundleByHash } from "./accessPaths";
import {
  principalPolicyReferenceCacheKey,
  verifiedPrincipalPolicyReferenceCacheKeys,
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

type AdmittedHistoricalEpochIds = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Tracks which pinned principal policy states prove the requester's
 * membership. Policies referenced only by historical manifests (e.g. a group
 * whose grant the rotation itself removed) are loaded lazily and fail-soft,
 * one principal at a time, so one unresolvable principal never discards the
 * proofs carried by others pinned alongside it.
 */
interface RequesterAudienceProofs {
  /** Reference keys already covered — member or not — to avoid reloads. */
  readonly coveredKeys: Set<string>;
  /** Reference keys of pinned states whose projection lists the requester. */
  readonly memberStateKeys: Set<string>;
  readonly userId: string;
}

function addPolicyToProofs(
  proofs: RequesterAudienceProofs,
  policy: VerifiedPrincipalPolicy,
): void {
  const isMember = (
    projection: readonly VerifiedPrincipalPolicy["projection"][number][],
  ): boolean =>
    projection.some(
      (member) =>
        member.memberPrincipalType === "user" &&
        member.memberPrincipalId === proofs.userId,
    );

  for (const key of verifiedPrincipalPolicyReferenceCacheKeys(policy)) {
    proofs.coveredKeys.add(key);
  }
  if (isMember(policy.projection)) {
    proofs.memberStateKeys.add(
      verifiedPrincipalPolicyStateReferenceCacheKey(policy.state),
    );
  }
  for (const entry of policy.history ?? []) {
    if (isMember(entry.projection)) {
      proofs.memberStateKeys.add(
        verifiedPrincipalPolicyStateReferenceCacheKey(entry.state),
      );
    }
  }
}

function createRequesterAudienceProofs(
  userId: string,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): RequesterAudienceProofs {
  const proofs: RequesterAudienceProofs = {
    coveredKeys: new Set<string>(),
    memberStateKeys: new Set<string>(),
    userId,
  };
  for (const policy of principalPolicies) {
    addPolicyToProofs(proofs, policy);
  }
  return proofs;
}

/**
 * Whether the pinned head's policy state lists the requester, loading the
 * policy fail-soft when the current access projection no longer carries it.
 */
async function pinnedHeadProvesMembership(
  context: ContainerWriterProjectionContext,
  proofs: RequesterAudienceProofs,
  principalHead: ReferencedPrincipalHead,
): Promise<boolean> {
  const headKey = principalPolicyReferenceCacheKey(principalHead);
  if (!proofs.coveredKeys.has(headKey)) {
    const policy = await loadPrincipalPolicyForReferencedHead(
      context.executor,
      principalHead,
    );
    if (policy) {
      addPolicyToProofs(proofs, policy);
    }
    // Cover the head either way so an unresolvable principal is not
    // re-queried for every epoch that pins it.
    proofs.coveredKeys.add(headKey);
  }
  return proofs.memberStateKeys.has(headKey);
}

/**
 * Whether the requester can be proven a member of the audience captured by
 * this pinned (era) manifest: a direct user grant, a pinned principal state
 * listing them, or — for inherited access — the same proof against the
 * pinned parent manifest chain. Everything resolves against the manifests
 * recorded at the time, never current state, so a member added later proves
 * nothing.
 */
async function requesterProvenInManifestEra(
  context: ContainerWriterProjectionContext,
  proofs: RequesterAudienceProofs,
  manifest: VerifiedContainerAccessManifest,
  visitedHashes: Set<string>,
): Promise<boolean> {
  if (visitedHashes.has(manifest.manifestHash)) {
    return false;
  }
  visitedHashes.add(manifest.manifestHash);

  if (
    manifest.state.directGrants.some(
      (grant) =>
        grant.subjectType === "user" && grant.subjectId === proofs.userId,
    )
  ) {
    return true;
  }
  for (const principalHead of manifest.state.referencedPrincipalHeads) {
    if (await pinnedHeadProvesMembership(context, proofs, principalHead)) {
      return true;
    }
  }

  const parentManifestHash = manifest.state.parentManifestHash;
  if (!parentManifestHash) {
    return false;
  }
  let parent: VerifiedContainerAccessManifest;
  try {
    parent = toVerifiedContainerManifest(
      await loadContainerManifestBundleByHash(context, parentManifestHash),
    );
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      return false;
    }
    throw error;
  }
  return requesterProvenInManifestEra(context, proofs, parent, visitedHashes);
}

interface ContainerManifestLineage {
  /** Key-epoch ids referenced by the verified previous-manifest chain. */
  readonly epochIds: ReadonlySet<string>;
  /**
   * For each lineage epoch, the verified manifests under which that epoch
   * was current — the era whose recorded audience gates the epoch.
   */
  readonly manifestsByEpochId: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
}

/**
 * Walks the container's own manifest lineage backwards from the current
 * manifest, collecting which key epochs the verified chain actually
 * references and the manifests recorded under each. Epoch rows outside this
 * chain (forked or unreferenced) are never served historically.
 */
async function loadContainerManifestLineage(
  context: ContainerWriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
): Promise<ContainerManifestLineage> {
  const containerId = manifest.state.containerId;
  const epochIds = new Set<string>();
  const manifestsByEpochId = new Map<
    string,
    VerifiedContainerAccessManifest[]
  >();
  const visitedHashes = new Set<string>();

  const record = (entry: VerifiedContainerAccessManifest): void => {
    const epochId = entry.state.containerKeyEpochId;
    if (!epochId) {
      return;
    }
    epochIds.add(epochId);
    let manifests = manifestsByEpochId.get(epochId);
    if (!manifests) {
      manifests = [];
      manifestsByEpochId.set(epochId, manifests);
    }
    manifests.push(entry);
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

  return { epochIds, manifestsByEpochId };
}

/**
 * Whether the requester is proven into this historical epoch's era through
 * any manifest recorded under it. Memoized per epoch by the caller.
 */
async function requesterProvenInEpochEra(
  context: ContainerWriterProjectionContext,
  proofs: RequesterAudienceProofs,
  eraManifests: readonly VerifiedContainerAccessManifest[],
): Promise<boolean> {
  const visitedHashes = new Set<string>();
  for (const manifest of eraManifests) {
    if (
      await requesterProvenInManifestEra(
        context,
        proofs,
        manifest,
        visitedHashes,
      )
    ) {
      return true;
    }
  }
  return false;
}

async function admitHistoricalWraps(input: {
  readonly admittedHistoricalEpochIds: AdmittedHistoricalEpochIds;
  readonly context: ContainerWriterProjectionContext;
  readonly eraManifests: readonly VerifiedContainerAccessManifest[];
  readonly proofs: RequesterAudienceProofs;
  readonly wraps: readonly ContainerKeyWrap[];
}): Promise<ContainerKeyWrap[]> {
  const { context, proofs } = input;
  let eraProven: boolean | null = null;
  const provenInEra = async (): Promise<boolean> => {
    eraProven ??= await requesterProvenInEpochEra(
      context,
      proofs,
      input.eraManifests,
    );
    return eraProven;
  };

  const admitted: ContainerKeyWrap[] = [];
  for (const wrap of input.wraps) {
    if (wrap.recipientKind === "user") {
      if (wrap.recipientId === proofs.userId) {
        admitted.push(wrap);
      }
      continue;
    }
    if (wrap.recipientKind === "container") {
      // A parent-epoch wrap is admissible when the requester was already
      // admitted to that parent epoch at an earlier path index, or when the
      // era's recorded audience provably includes them (the common shape
      // where a child rotated while its parent epoch stayed current). A
      // member granted parent access after the rotation matches neither.
      if (
        input.admittedHistoricalEpochIds
          .get(wrap.recipientId)
          ?.has(wrap.recipientKeyEpochId) === true ||
        (await provenInEra())
      ) {
        admitted.push(wrap);
      }
      continue;
    }
    // Principal wraps require membership at a policy state the epoch's own
    // manifests pinned — current membership proves nothing about the past.
    for (const manifest of input.eraManifests) {
      const pinnedHead = manifest.state.referencedPrincipalHeads.find(
        (principalHead) => principalHead.principalId === wrap.recipientId,
      );
      if (
        pinnedHead &&
        (await pinnedHeadProvesMembership(context, proofs, pinnedHead))
      ) {
        admitted.push(wrap);
        break;
      }
    }
  }
  return admitted;
}

/**
 * Superseded key epochs for one container, limited to epochs the verified
 * manifest lineage references, with wraps filtered to recipients whose
 * recorded era audience provably includes the REQUESTER: the user directly,
 * principals whose pinned policy state lists them (including policies the
 * rotation itself unreferenced), or parent-epoch wraps backed by an
 * admitted parent epoch or an era-membership proof. Epochs whose filtered
 * wrap set is empty are omitted — a member added after a rotation simply
 * receives nothing from before their time. Clients re-verify every unwrap
 * against the epoch id's key-material commitment.
 */
export async function loadHistoricalContainerKeks(input: {
  /**
   * Historical epochs already served to this requester at earlier (parent)
   * path indices; admissible targets for container wraps.
   */
  readonly admittedHistoricalEpochIds: AdmittedHistoricalEpochIds;
  readonly context: ContainerWriterProjectionContext;
  readonly manifest: VerifiedContainerAccessManifest;
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
  const proofs = createRequesterAudienceProofs(
    input.userId,
    input.principalPolicies,
  );
  const historicalKeks: HistoricalContainerKekResponse[] = [];

  for (const epoch of epochs) {
    if (epoch.id === currentEpochId || !lineage.epochIds.has(epoch.id)) {
      continue;
    }
    const wraps = await admitHistoricalWraps({
      admittedHistoricalEpochIds: input.admittedHistoricalEpochIds,
      context: input.context,
      eraManifests: lineage.manifestsByEpochId.get(epoch.id) ?? [],
      proofs,
      wraps: await listContainerKeyWraps(epoch.id, input.context.executor),
    });
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
