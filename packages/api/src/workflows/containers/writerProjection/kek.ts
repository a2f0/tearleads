import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type {
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeContainerKeyEpochHash,
  verifyContainerKekState,
} from "@tearleads/crypto";
import type { HistoricalContainerKekResponse } from "@tearleads/validators/response";
import { inArray } from "drizzle-orm";
import {
  getContainerKeyEpochById,
  listContainerKeyEpochs,
  listContainerKeyWraps,
} from "../../../access/read/containerKekStore";
import { loadContainerManifestBundleByHash } from "./accessPaths";
import { cachedProjectionValue } from "./context";
import { principalPolicyCacheKey } from "./principalPolicies";
import {
  containerKeyWrapRecord,
  stripContainerKeyEpoch,
  stripContainerKeyWrap,
  toVerifiedContainerManifest,
} from "./records";
import {
  type ContainerKekManifestHistory,
  type ContainerKekProjection,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "./types";

function containerKekStateCacheKey(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): string {
  // KEK verification depends on the signed manifest, the parent KEK edge, and
  // the exact referenced principal policy heads. Include all three so a cache
  // hit cannot hide stale parent key material or a missing policy proof.
  const parentKey = input.parentKekState
    ? [
        input.parentKekState.containerId,
        input.parentKekState.accessManifestHash,
        input.parentKekState.containerKeyEpochId,
        input.parentKekState.keyEpochHash,
      ].join(":")
    : "root";

  return [
    input.manifest.manifestHash,
    parentKey,
    principalPolicyCacheKey({
      manifest: input.manifest,
      principalPolicies: input.principalPolicies,
    }),
  ].join("||");
}

export async function loadContainerKekManifestHistory(input: {
  readonly context: ContainerWriterProjectionContext;
  readonly currentManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ReturnType<typeof stripContainerKeyEpoch>;
  readonly wraps: readonly ContainerKeyWrap[];
  // Limit traversal to the mutated container's own manifest lineage (skip the
  // walk up to parent containers). Used by the mutation response, where the
  // client already holds the parent path and only needs this container's
  // previous-epoch manifest to verify the transition — avoiding an N+1 ancestry
  // walk inside the write transaction.
  readonly onlyCurrentContainer?: boolean;
}): Promise<ContainerKekManifestHistory> {
  const currentContainerId = input.currentManifest.state.containerId;
  const pendingHashes = new Set<string>();
  const visitedHashes = new Set([input.currentManifest.manifestHash]);
  const enqueue = (manifestHash: string | null): void => {
    if (!manifestHash || visitedHashes.has(manifestHash)) {
      return;
    }
    pendingHashes.add(manifestHash);
  };

  enqueue(input.currentManifest.manifest.previousManifestHash);
  enqueue(input.keyEpoch.accessManifestHash);
  enqueue(input.keyEpoch.createdByManifestHash);
  for (const wrap of input.wraps) {
    enqueue(wrap.wrapManifestHash);
  }

  const bundles: ContainerKekManifestHistory["bundles"] = [];
  const verified: ContainerKekManifestHistory["verified"] = [];
  while (pendingHashes.size > 0) {
    const next = pendingHashes.values().next();
    if (next.done) {
      break;
    }
    const manifestHash = next.value;
    pendingHashes.delete(manifestHash);
    visitedHashes.add(manifestHash);

    const bundle = await loadContainerManifestBundleByHash(
      input.context,
      manifestHash,
    );
    const verifiedManifest = toVerifiedContainerManifest(bundle);
    const isCurrentContainer =
      verifiedManifest.state.containerId === currentContainerId;
    bundles.push(bundle);
    if (isCurrentContainer) {
      verified.push(verifiedManifest);
    }
    // When limiting to the current container, only keep following the lineage
    // of manifests that belong to it, and never cross into parent containers.
    if (!input.onlyCurrentContainer || isCurrentContainer) {
      enqueue(verifiedManifest.manifest.previousManifestHash);
    }
    if (!input.onlyCurrentContainer) {
      enqueue(verifiedManifest.state.parentManifestHash);
    }
  }

  return { bundles, verified };
}

function collectDirectUserGrantIds(
  manifest: VerifiedContainerAccessManifest,
): string[] {
  return [
    ...new Set(
      manifest.state.directGrants
        .filter((grant) => grant.subjectType === "user")
        .map((grant) => grant.subjectId),
    ),
  ].sort();
}

function userRecipientKeyFromWrap(
  wrap: ContainerKeyWrap,
): ContainerUserRecipientKey {
  return {
    userId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
  };
}

async function loadUserRecipientKeysForContainerKek(input: {
  readonly executor: DatabaseSession;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly wraps: readonly ContainerKeyWrap[];
}): Promise<ContainerUserRecipientKey[]> {
  const userIds = collectDirectUserGrantIds(input.manifest);
  if (userIds.length === 0) {
    return [];
  }

  const userIdSet = new Set(userIds);
  const keyByUserId = new Map<string, ContainerUserRecipientKey>();
  for (const wrap of input.wraps) {
    if (wrap.recipientKind !== "user" || !userIdSet.has(wrap.recipientId)) {
      continue;
    }

    if (keyByUserId.has(wrap.recipientId)) {
      throw new ContainerWriterProjectionError(
        "Container KEK user recipient key is ambiguous",
        409,
      );
    }
    keyByUserId.set(wrap.recipientId, userRecipientKeyFromWrap(wrap));
  }

  const storedUsers = await input.executor
    .select({
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      id: users.id,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const storedUserById = new Map(storedUsers.map((user) => [user.id, user]));
  const userRecipientKeys: ContainerUserRecipientKey[] = [];

  for (const userId of userIds) {
    const userRecipientKey = keyByUserId.get(userId);
    const storedUser = storedUserById.get(userId);
    if (!userRecipientKey || !storedUser) {
      throw new ContainerWriterProjectionError(
        "Container KEK user recipient key missing",
        409,
      );
    }
    if (
      userRecipientKey.recipientKeyFingerprint !==
      storedUser.encapsulationKeyFingerprint
    ) {
      throw new ContainerWriterProjectionError(
        "Container KEK user recipient key is stale",
        409,
      );
    }
    userRecipientKeys.push(userRecipientKey);
  }

  return userRecipientKeys;
}

/**
 * The principals through which the requesting user can currently unwrap keys:
 * every verified referenced policy whose membership projection includes them.
 */
function requesterPrincipalIds(
  userId: string,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): ReadonlySet<string> {
  return new Set(
    principalPolicies
      .filter((policy) =>
        policy.projection.some(
          (member) =>
            member.memberPrincipalType === "user" &&
            member.memberPrincipalId === userId,
        ),
      )
      .map((policy) => policy.principalId),
  );
}

/**
 * Superseded key epochs for one container, with wraps filtered to recipients
 * whose key material proves the REQUESTER was in the epoch's audience: the
 * user directly, principals they currently derive access through, or path
 * containers — but only at a SUPERSEDED parent epoch. A wrap to a parent's
 * CURRENT epoch is never served: every current member (including one granted
 * access after the child's rotation) holds that epoch, so serving it would
 * disclose pre-grant child key material. A superseded parent epoch is only
 * reachable through the requester's own filtered historical wraps, which is
 * the audience proof this filter requires. Epochs whose filtered wrap set is
 * empty are omitted — a member added after a rotation simply receives
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
  const principalIds = requesterPrincipalIds(
    input.userId,
    input.principalPolicies,
  );
  const historicalKeks: HistoricalContainerKekResponse[] = [];

  for (const epoch of epochs) {
    if (epoch.id === currentEpochId) {
      continue;
    }
    const wraps = (
      await listContainerKeyWraps(epoch.id, input.context.executor)
    ).filter((wrap) => {
      if (wrap.recipientKind === "user") {
        return wrap.recipientId === input.userId;
      }
      if (wrap.recipientKind === "container") {
        const recipientCurrentEpochId = input.pathContainerKeyEpochIds.get(
          wrap.recipientId,
        );
        return (
          recipientCurrentEpochId !== undefined &&
          recipientCurrentEpochId !== wrap.recipientKeyEpochId
        );
      }
      return principalIds.has(wrap.recipientId);
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

export async function loadContainerKekState(
  context: ContainerWriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
  input: {
    readonly parentKekState: VerifiedContainerKekState | null;
    readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  },
): Promise<ContainerKekProjection> {
  return cachedProjectionValue(
    context.containerKekStateByCacheKey,
    containerKekStateCacheKey({
      manifest,
      parentKekState: input.parentKekState,
      principalPolicies: input.principalPolicies,
    }),
    async () =>
      loadUncachedContainerKekState(context, manifest, {
        parentKekState: input.parentKekState,
        principalPolicies: input.principalPolicies,
      }),
  );
}

async function loadUncachedContainerKekState(
  context: ContainerWriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
  input: {
    readonly parentKekState: VerifiedContainerKekState | null;
    readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  },
): Promise<ContainerKekProjection> {
  const containerKeyEpochId = manifest.state.containerKeyEpochId;
  if (!containerKeyEpochId) {
    throw new ContainerWriterProjectionError(
      "Container KEK state missing",
      409,
    );
  }

  const storedKeyEpoch = await getContainerKeyEpochById(
    containerKeyEpochId,
    context.executor,
  );
  if (!storedKeyEpoch) {
    throw new ContainerWriterProjectionError(
      "Container KEK epoch missing",
      409,
    );
  }
  if (storedKeyEpoch.containerId !== manifest.state.containerId) {
    throw new ContainerWriterProjectionError(
      "Container KEK epoch is stale",
      409,
    );
  }

  const keyEpoch = stripContainerKeyEpoch(storedKeyEpoch);
  const wraps = (
    await listContainerKeyWraps(containerKeyEpochId, context.executor)
  ).map(stripContainerKeyWrap);
  const containerManifestHistory = await loadContainerKekManifestHistory({
    context,
    currentManifest: manifest,
    keyEpoch,
    wraps,
  });
  const userRecipientKeys = await loadUserRecipientKeysForContainerKek({
    executor: context.executor,
    manifest,
    wraps,
  });
  const verified = await verifyContainerKekState({
    containerManifest: manifest,
    containerManifestHistory: containerManifestHistory.verified,
    keyEpoch,
    parentKekState: input.parentKekState,
    principalPolicies: input.principalPolicies,
    userRecipientKeys,
    wraps,
  });

  if (!verified.ok) {
    throw new ContainerWriterProjectionError(verified.error.message, 409);
  }

  return {
    manifestHistory: containerManifestHistory.bundles,
    state: verified.value,
  };
}
