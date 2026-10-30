import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import type {
  ContainerAccessLevel,
  PrincipalPolicyAuthorization,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { resolveContainerPathUserAccessLevel } from "@tearleads/crypto";
import {
  type AccessManifestBundleWireResponse,
  CONTAINER_NOT_FOUND_ERROR_CODE,
} from "@tearleads/validators/response";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { eq, inArray } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getAccessManifestBundles,
  getCurrentAccessManifestHead,
  getCurrentAccessManifestHeads,
  getObjectAccessManifestBundles,
} from "../../../access/read/accessManifestStore";
import { cachedProjectionValue } from "./context";
import {
  loadPrincipalPoliciesForAccessPaths,
  principalPolicyReferenceCacheKey,
} from "./principalPolicies";
import { toManifestBundleResponse } from "./records";
import { verifyStoredContainerManifest } from "./storedManifestVerification";
import {
  type ContainerAccessPath,
  type ContainerAccessProjection,
  type ContainerPathRow,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "./types";

function isAccessLevelAtLeast(
  accessLevel: ContainerAccessLevel | null,
  minimumAccessLevel: ContainerAccessLevel,
): accessLevel is ContainerAccessLevel {
  if (accessLevel === null) {
    return false;
  }

  if (accessLevel === "admin" || accessLevel === minimumAccessLevel) {
    return true;
  }

  return minimumAccessLevel === "read" && accessLevel === "write";
}

async function loadContainerPath(
  context: ContainerWriterProjectionContext,
  containerId: string,
): Promise<ContainerPathRow[]> {
  const path: ContainerPathRow[] = [];
  const seenContainerIds = new Set<string>();
  let currentContainerId: string | null = containerId;

  while (currentContainerId !== null) {
    if (path.length >= MAX_CONTAINER_PATH_LENGTH) {
      throw new ContainerWriterProjectionError(
        "Container path exceeds maximum depth",
        409,
      );
    }
    if (seenContainerIds.has(currentContainerId)) {
      throw new ContainerWriterProjectionError(
        "Container path contains a cycle",
        409,
      );
    }
    seenContainerIds.add(currentContainerId);

    let row: ContainerPathRow;
    try {
      row = await loadContainerPathRow(context, currentContainerId);
    } catch (error) {
      if (
        !(error instanceof ContainerWriterProjectionError) ||
        error.status !== 404
      ) {
        throw error;
      }
      if (path.length === 0) {
        throw new ContainerWriterProjectionError(
          error.message,
          404,
          CONTAINER_NOT_FOUND_ERROR_CODE,
        );
      }
      throw new ContainerWriterProjectionError(
        "Container path ancestor not found",
        409,
      );
    }
    path.push(row);
    currentContainerId = row.parentId;
  }

  return path.reverse();
}

async function loadContainerPathRow(
  context: ContainerWriterProjectionContext,
  containerId: string,
): Promise<ContainerPathRow> {
  return cachedProjectionValue(
    context.containerPathRowById,
    containerId,
    async () => {
      const [row] = await context.executor
        .select({
          id: containers.id,
          organizationId: containers.organizationId,
          parentId: containers.parentId,
        })
        .from(containers)
        .where(eq(containers.id, containerId))
        .limit(1);

      if (!row) {
        throw new ContainerWriterProjectionError("Container not found", 404);
      }

      return row;
    },
  );
}

async function loadCurrentContainerManifestBundle(
  context: ContainerWriterProjectionContext,
  containerId: string,
) {
  // The cache is intentionally scoped to one projection transaction. That keeps
  // repeated shared ancestors consistent within the response without reusing
  // current-head or authorization material across requests.
  return cachedProjectionValue(
    context.currentManifestBundleByContainerId,
    containerId,
    async () => {
      const head = await getCurrentAccessManifestHead(
        "container",
        containerId,
        context.executor,
      );
      if (!head) {
        throw new ContainerWriterProjectionError(
          "Container manifest head missing",
          409,
        );
      }

      return loadContainerManifestBundleByHash(context, head.manifestHash);
    },
  );
}

/**
 * Load a container's whole retained lineage, with the verification markers its
 * rows carry, in a few batched queries before a walk that would otherwise
 * issue several queries per manifest. Only bundles not already cached are
 * installed.
 */
export async function prefetchContainerManifestHistory(
  context: ContainerWriterProjectionContext,
  containerId: string,
): Promise<void> {
  if (context.prefetchedHistoryContainerIds.has(containerId)) return;
  context.prefetchedHistoryContainerIds.add(containerId);
  const bundles = await getObjectAccessManifestBundles(
    "container",
    containerId,
    context.executor,
  );
  for (const [manifestHash, bundle] of bundles) {
    if (!context.manifestBundleByHash.has(manifestHash))
      context.manifestBundleByHash.set(
        manifestHash,
        Promise.resolve(toManifestBundleResponse(bundle)),
      );
    context.verificationMarkers.seed(bundle);
  }
}

// Keeps each IN list well inside every supported dialect's bind limit.
const PATH_PREFETCH_BATCH_SIZE = 500;

function prefetchBatches(ids: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += PATH_PREFETCH_BATCH_SIZE)
    batches.push(ids.slice(offset, offset + PATH_PREFETCH_BATCH_SIZE));
  return batches;
}

async function prefetchContainerPathRows(
  context: ContainerWriterProjectionContext,
  containerIds: readonly string[],
): Promise<string[]> {
  const loadedIds: string[] = [];
  let frontier = [...new Set(containerIds)].filter(
    (containerId) => !context.containerPathRowById.has(containerId),
  );
  // One read per level, never more levels than a valid path can have.
  for (
    let level = 0;
    frontier.length > 0 && level < MAX_CONTAINER_PATH_LENGTH;
    level += 1
  ) {
    const parentIds = new Set<string>();
    for (const batch of prefetchBatches(frontier)) {
      const rows = await context.executor
        .select({
          id: containers.id,
          organizationId: containers.organizationId,
          parentId: containers.parentId,
        })
        .from(containers)
        .where(inArray(containers.id, batch));
      for (const row of rows) {
        if (context.containerPathRowById.has(row.id)) continue;
        context.containerPathRowById.set(row.id, Promise.resolve(row));
        loadedIds.push(row.id);
        if (row.parentId !== null) parentIds.add(row.parentId);
      }
    }
    frontier = [...parentIds].filter(
      (containerId) => !context.containerPathRowById.has(containerId),
    );
  }
  return loadedIds;
}

async function prefetchCurrentContainerManifestBundles(
  context: ContainerWriterProjectionContext,
  containerIds: readonly string[],
): Promise<void> {
  const uncachedIds = containerIds.filter(
    (containerId) =>
      !context.currentManifestBundleByContainerId.has(containerId),
  );
  const headHashByContainerId = new Map<string, string>();
  for (const batch of prefetchBatches(uncachedIds)) {
    const heads = await getCurrentAccessManifestHeads(
      "container",
      batch,
      context.executor,
    );
    for (const [containerId, head] of heads)
      headHashByContainerId.set(containerId, head.manifestHash);
  }
  const uncachedHashes = [...new Set(headHashByContainerId.values())].filter(
    (manifestHash) => !context.manifestBundleByHash.has(manifestHash),
  );
  for (const batch of prefetchBatches(uncachedHashes)) {
    // An incomplete, unreadable, or non-container bundle stays uncached: the
    // walk that reaches it reloads it and fails exactly as it would have
    // without the prefetch, inside that container's own error handling.
    const bundles = await getAccessManifestBundles(
      batch,
      context.executor,
      true,
    );
    for (const [manifestHash, bundle] of bundles) {
      if (bundle.manifest.objectKind !== "container") continue;
      let response: AccessManifestBundleWireResponse;
      try {
        response = toManifestBundleResponse(bundle);
      } catch {
        continue;
      }
      context.manifestBundleByHash.set(manifestHash, Promise.resolve(response));
      context.verificationMarkers.seed(bundle);
    }
  }
  for (const [containerId, manifestHash] of headHashByContainerId) {
    const bundle = context.manifestBundleByHash.get(manifestHash);
    if (bundle && !context.currentManifestBundleByContainerId.has(containerId))
      context.currentManifestBundleByContainerId.set(containerId, bundle);
  }
}

/**
 * Set-load the rows, current heads, and manifest bundles of every container on
 * these containers' paths: one read per path level plus one for the heads and
 * one for the bundles, instead of three serial reads per path container. Only
 * what was found is cached, so a missing row, head, or bundle is read again by
 * the walk and raises the same 404 or 409. Every path is still verified.
 */
export async function prefetchContainerAccessPaths(
  context: ContainerWriterProjectionContext,
  containerIds: readonly string[],
): Promise<void> {
  const pathContainerIds = await prefetchContainerPathRows(
    context,
    containerIds,
  );
  await prefetchCurrentContainerManifestBundles(context, pathContainerIds);
}

export async function loadContainerManifestBundleByHash(
  context: ContainerWriterProjectionContext,
  manifestHash: string,
) {
  return cachedProjectionValue(
    context.manifestBundleByHash,
    manifestHash,
    async () => {
      const bundle = await getAccessManifestBundle(
        manifestHash,
        context.executor,
      );
      if (bundle?.manifest.objectKind !== "container") {
        throw new ContainerWriterProjectionError(
          "Container manifest bundle missing",
          409,
        );
      }

      context.verificationMarkers.seed(bundle);
      return toManifestBundleResponse(bundle);
    },
  );
}

export async function loadContainerAccessPath(
  context: ContainerWriterProjectionContext,
  containerId: string,
): Promise<ContainerAccessPath> {
  const pathRows = await loadContainerPath(context, containerId);
  const path = await gatherWithExecutor(context.executor, pathRows, (row) =>
    loadCurrentContainerManifestBundle(context, row.id),
  );

  const verifiedPath: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of path.entries()) {
    const row = pathRows[index];
    if (!row) {
      throw new ContainerWriterProjectionError(
        "Container path row missing",
        409,
      );
    }
    const verified = await verifyStoredContainerManifest({
      bundle,
      context,
      loadBundle: (manifestHash) =>
        loadContainerManifestBundleByHash(context, manifestHash),
    });
    if (
      verified.state.containerId !== row.id ||
      verified.state.organizationId !== row.organizationId ||
      verified.state.parentContainerId !== row.parentId
    ) {
      throw new ContainerWriterProjectionError(
        "Container row does not match signed manifest state",
        409,
      );
    }
    const parent = verifiedPath.at(-1);
    if (
      parent &&
      verified.state.parentContainerId !== parent.state.containerId
    ) {
      throw new ContainerWriterProjectionError(
        "Container path does not match signed manifest edges",
        409,
      );
    }
    verifiedPath.push(verified);
  }

  return { path, verifiedPath };
}

export function buildContainerAccessProjection(input: {
  readonly accessPath: ContainerAccessPath;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly principalPolicies: PrincipalPolicyAuthorization[];
  readonly userId: string;
}): ContainerAccessProjection {
  const accessLevel = resolveContainerPathUserAccessLevel({
    path: input.accessPath.verifiedPath,
    principalPolicies: input.principalPolicies,
    userId: input.userId,
  });

  if (!isAccessLevelAtLeast(accessLevel, input.minimumAccessLevel)) {
    throw new ContainerWriterProjectionError("Forbidden", 403);
  }

  return {
    accessLevel,
    path: input.accessPath.path,
    principalPolicies: input.principalPolicies,
    verifiedPath: input.accessPath.verifiedPath,
  };
}

export function asContainerWriterProjectionError(
  error: unknown,
): ContainerWriterProjectionError | null {
  return error instanceof ContainerWriterProjectionError ? error : null;
}

export function principalPoliciesForAccessPath(
  principalPoliciesByReference: ReadonlyMap<
    string,
    PrincipalPolicyAuthorization
  >,
  accessPath: ContainerAccessPath,
): PrincipalPolicyAuthorization[] {
  const policiesByReference = new Map<string, PrincipalPolicyAuthorization>();

  for (const manifest of accessPath.verifiedPath) {
    for (const reference of manifest.state.referencedPrincipalHeads) {
      const referenceKey = principalPolicyReferenceCacheKey(reference);
      const policy = principalPoliciesByReference.get(referenceKey);
      if (policy) {
        policiesByReference.set(referenceKey, policy);
      }
    }
  }

  return Array.from(policiesByReference.values());
}

export async function resolveSingleContainerAccessProjection(input: {
  readonly context: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseSession;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly userId: string;
}): Promise<ContainerAccessProjection> {
  const accessPath = await loadContainerAccessPath(
    input.context,
    input.containerId,
  );
  const principalPolicies = await loadPrincipalPoliciesForAccessPaths(
    input.context.executor,
    [accessPath.verifiedPath],
    [],
    input.context.principalPolicyByReference,
  );

  return buildContainerAccessProjection({
    accessPath,
    minimumAccessLevel: input.minimumAccessLevel,
    principalPolicies,
    userId: input.userId,
  });
}
