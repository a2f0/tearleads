import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  containerHasDiscoveryAccess,
  discoveryGrantSubjects,
} from "../services/containers/containerDiscoveryAccess";
import { uuidValue } from "../utils/postgresSql";
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

const containerDepthRowSchema = z.object({
  depth: z.coerce.number().int().nonnegative(),
  id: z.string(),
});

/**
 * Bound per-pass verification work to `maxPathContainers` (`SUM(depth + 1)`),
 * querying depth ONLY for containers the caller has a discovery grant on so an
 * attacker cannot use budget exhaustion as an existence or exact-depth oracle
 * against unauthorized containers in the same or another organization.
 */
async function admitContainerIdsWithinPathBudget(
  executor: DatabaseSession,
  userId: string,
  containerIds: readonly string[],
  maxPathContainers: number,
): Promise<string[]> {
  if (containerIds.length === 0) return [];
  const uniqueIds = [...new Set(containerIds)];
  const result = await executor.execute(sql`
    with ${discoveryGrantSubjects(userId)}
    select c.id, c.depth
    from ${containers} c
    where c.id in (${sql.join(
      uniqueIds.map((id) => uuidValue(id)),
      sql`, `,
    )})
      and ${containerHasDiscoveryAccess(sql`c.id`)}
  `);
  const depthById = new Map<string, number>();
  for (const rawRow of result.rows) {
    const parsed = containerDepthRowSchema.safeParse(rawRow);
    if (parsed.success) {
      depthById.set(parsed.data.id, parsed.data.depth);
    }
  }
  let usedPathContainers = 0;
  const admitted: string[] = [];
  for (const id of uniqueIds) {
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
  // Repeatable-read read-only snapshot keeps the depth pre-check and signed
  // access verification consistent across concurrent container moves.
  const { markers, proofs } = await db.transaction(
    async (executor) => {
      const admitted = await admitContainerIdsWithinPathBudget(
        executor,
        userId,
        containerIds,
        maxPathContainers,
      );
      if (admitted.length === 0) {
        const emptyProofs: VerifiedContainerInterest[] = [];
        return { markers: null, proofs: emptyProofs };
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
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
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
