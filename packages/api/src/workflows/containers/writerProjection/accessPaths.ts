import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import type {
  ContainerAccessLevel,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { resolveContainerPathUserAccessLevel } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../../../access/read/accessManifestStore";
import { cachedProjectionValue } from "./context";
import {
  loadPrincipalPoliciesForAccessPaths,
  principalPolicyReferenceCacheKey,
} from "./principalPolicies";
import {
  toManifestBundleResponse,
  toVerifiedContainerManifest,
} from "./records";
import {
  type ContainerAccessPath,
  type ContainerAccessProjection,
  type ContainerPathRow,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "./types";

const MAX_CONTAINER_PATH_DEPTH = 100;

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
    if (path.length >= MAX_CONTAINER_PATH_DEPTH) {
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

    const row = await loadContainerPathRow(context, currentContainerId);
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
      if (!bundle || bundle.manifest.objectKind !== "container") {
        throw new ContainerWriterProjectionError(
          "Container manifest bundle missing",
          409,
        );
      }

      return toManifestBundleResponse({
        event: bundle.event,
        manifest: bundle.manifest,
        manifestHash: bundle.manifestHash,
        state: bundle.state,
      });
    },
  );
}

export async function loadContainerAccessPath(
  context: ContainerWriterProjectionContext,
  containerId: string,
): Promise<ContainerAccessPath> {
  const pathRows = await loadContainerPath(context, containerId);
  const path = await Promise.all(
    pathRows.map((row) => loadCurrentContainerManifestBundle(context, row.id)),
  );

  return {
    path,
    verifiedPath: path.map(toVerifiedContainerManifest),
  };
}

export function buildContainerAccessProjection(input: {
  readonly accessPath: ContainerAccessPath;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly principalPolicies: VerifiedPrincipalPolicy[];
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
  principalPoliciesByReference: ReadonlyMap<string, VerifiedPrincipalPolicy>,
  accessPath: ContainerAccessPath,
): VerifiedPrincipalPolicy[] {
  const policiesByReference = new Map<string, VerifiedPrincipalPolicy>();

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
  );

  return buildContainerAccessProjection({
    accessPath,
    minimumAccessLevel: input.minimumAccessLevel,
    principalPolicies,
    userId: input.userId,
  });
}
