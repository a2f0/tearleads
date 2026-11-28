import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";
import {
  type AuthorizeContainerAccess,
  principalInterestKey,
  type VerifiedContainerInterest,
} from "./containerInterestTypes";

/**
 * Total ancestor-path containers admitted in one authorization pass
 * (`SUM(depth + 1)` across admitted roots). Keeps worst-case work bounded
 * even when a socket declares many deeply nested direct grants.
 */
const MAX_PATH_CONTAINERS_PER_AUTHORIZATION = 1_024;

async function admitContainerIdsWithinPathBudget(
  executor: DatabaseSession,
  containerIds: readonly string[],
  maxPathContainers: number,
): Promise<string[]> {
  if (containerIds.length === 0) return [];
  const rows = await executor
    .select({ depth: containers.depth, id: containers.id })
    .from(containers)
    .where(inArray(containers.id, [...containerIds]));
  const depthById = new Map(rows.map((row) => [row.id, row.depth]));
  let usedPathContainers = 0;
  const admitted: string[] = [];
  const seen = new Set<string>();
  for (const id of containerIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const depth = depthById.get(id);
    if (depth === undefined) continue;
    const pathLength = Math.max(0, depth) + 1;
    if (usedPathContainers + pathLength > maxPathContainers) continue;
    usedPathContainers += pathLength;
    admitted.push(id);
  }
  return admitted;
}

export async function authorizeContainerAccessWithWorkflow(
  userId: string,
  containerIds: readonly string[],
  options?: {
    readonly db?: ApiDatabase | undefined;
    readonly maxPathContainers?: number | undefined;
  },
): Promise<VerifiedContainerInterest[]> {
  if (containerIds.length === 0) return [];
  const maxPathContainers =
    options?.maxPathContainers ?? MAX_PATH_CONTAINERS_PER_AUTHORIZATION;
  const [runtimeModule, accessModule, projectionModule, markersModule] =
    await Promise.all([
      options?.db ? null : import("../services/runtime"),
      import("../workflows/keyingReadAccess"),
      import("../workflows/containers/writerProjection"),
      import("../workflows/containers/writerProjection/verificationMarkers"),
    ]);
  const db = options?.db ?? runtimeModule?.getDefaultApiServiceRuntime().db;
  if (!db) return [];
  const { markers, proofs } = await db.transaction(async (executor) => {
    const admitted = await admitContainerIdsWithinPathBudget(
      executor,
      containerIds,
      maxPathContainers,
    );
    if (admitted.length === 0) {
      const proofs: VerifiedContainerInterest[] = [];
      return { markers: null, proofs };
    }
    const context =
      projectionModule.createContainerWriterProjectionContext(executor);
    const results = await accessModule.resolveReadableContainerAccessBatch({
      containerIds: admitted,
      context,
      executor,
      userId,
    });
    const verified = admitted.flatMap((containerId) => {
      const result = results.get(containerId);
      if (result?.status !== "fulfilled") return [];
      return [
        {
          containerId,
          principalKeys: result.value.principalPolicies
            .filter((policy) => policy.principalType === "group")
            .map(principalInterestKey),
          pathContainerIds: result.value.verifiedPath.map(
            (manifest) => manifest.state.containerId,
          ),
        },
      ];
    });
    return { markers: context.verificationMarkers, proofs: verified };
  });
  // Write back any verification markers earned by full verification outside
  // the read transaction so later passes hit markers instead of re-verifying.
  if (markers) {
    await markersModule.flushVerificationMarkersAfterRead(markers, db);
  }
  return proofs;
}

// Type assertion keeps the exported function compatible with AuthorizeContainerAccess.
const _assertSignature: AuthorizeContainerAccess =
  authorizeContainerAccessWithWorkflow;
void _assertSignature;
