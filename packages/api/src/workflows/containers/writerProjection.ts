import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  ContainerAccessLevel,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  asContainerWriterProjectionError,
  buildContainerAccessProjection,
  loadContainerAccessPath,
  principalPoliciesForAccessPath,
  resolveSingleContainerAccessProjection,
} from "./writerProjection/accessPaths";
import { createContainerWriterProjectionContext } from "./writerProjection/context";
import { loadHistoricalContainerKeks } from "./writerProjection/historicalKeks";
import { loadContainerKekState } from "./writerProjection/kek";
import {
  loadPrincipalPoliciesForAccessPaths,
  verifiedPrincipalPolicyReferenceCacheKeys,
} from "./writerProjection/principalPolicies";
import { containerKekResponse } from "./writerProjection/records";
import {
  type ContainerAccessPath,
  type ContainerAccessProjection,
  type ContainerAccessProjectionResult,
  type ContainerKekProjection,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "./writerProjection/types";

export type {
  ContainerAccessProjection,
  ContainerAccessProjectionResult,
  ContainerWriterProjectionContext,
};
export {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
};

async function resolveContainerProjectionWithAccess(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseSession;
  /**
   * Whether to load and serve superseded key epochs. Access-only callers
   * (e.g. the per-sync authorization check, which discards the response)
   * pass false so routine syncs never pay the manifest-lineage walk and
   * historical policy loading that only clients healing rotated content
   * need.
   */
  readonly includeHistoricalKeks?: boolean;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  const context =
    input.context ?? createContainerWriterProjectionContext(input.executor);
  const access = await resolveContainerAccessProjection({
    ...input,
    context,
  });

  const containerKekStates: ContainerKekProjection[] = [];
  for (const manifest of access.verifiedPath) {
    containerKekStates.push(
      await loadContainerKekState(context, manifest, {
        parentKekState: containerKekStates.at(-1)?.state ?? null,
        principalPolicies: access.principalPolicies,
      }),
    );
  }
  const targetManifest = access.verifiedPath.at(-1);
  if (!targetManifest) {
    throw new ContainerWriterProjectionError("Container not found", 404);
  }

  // Superseded key epochs travel with each path container so a member who
  // spans a KEK rotation can still unwrap pre-rotation content (e.g. stale
  // document content-key bundles after a revoke). Filtered per requester —
  // see loadHistoricalContainerKeks. Parents are processed first, so the
  // epochs admitted for each container gate the container wraps of every
  // descendant on the path.
  const admittedHistoricalEpochIds = new Map<string, ReadonlySet<string>>();
  const containerKeks: ContainerWriterProjectionResponse["containerKeks"] = [];
  for (const [index, manifest] of access.verifiedPath.entries()) {
    const kekState = containerKekStates[index];
    if (!kekState) {
      throw new ContainerWriterProjectionError("Container KEK missing", 409);
    }
    const historicalKeks =
      input.includeHistoricalKeks === false
        ? []
        : await loadHistoricalContainerKeks({
            admittedHistoricalEpochIds,
            context,
            manifest,
            principalPolicies: access.principalPolicies,
            userId: input.userId,
          });
    admittedHistoricalEpochIds.set(
      manifest.state.containerId,
      new Set(historicalKeks.map((kek) => kek.containerKeyEpochId)),
    );
    containerKeks.push(containerKekResponse(kekState, historicalKeks));
  }

  return {
    containerId: input.containerId,
    organizationId: targetManifest.state.organizationId,
    path: access.path,
    containerKeks,
  };
}

export async function resolveContainerReaderProjection(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseSession;
  readonly includeHistoricalKeks?: boolean;
  readonly userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  return resolveContainerProjectionWithAccess({
    ...input,
    minimumAccessLevel: "read",
  });
}

export async function resolveContainerWriterProjection(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseSession;
  readonly includeHistoricalKeks?: boolean;
  readonly userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  return resolveContainerProjectionWithAccess({
    ...input,
    minimumAccessLevel: "write",
  });
}

export async function resolveContainerAccessProjection(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseSession;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly userId: string;
}): Promise<ContainerAccessProjection> {
  const context =
    input.context ?? createContainerWriterProjectionContext(input.executor);

  const projection = await resolveSingleContainerAccessProjection({
    ...input,
    context,
  });
  return projection;
}

export async function resolveContainerAccessProjectionBatch(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerIds: readonly string[];
  readonly executor: DatabaseSession;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly userId: string;
}): Promise<Map<string, ContainerAccessProjectionResult>> {
  const context =
    input.context ?? createContainerWriterProjectionContext(input.executor);
  const containerIds = [...new Set(input.containerIds)].sort();
  const results = new Map<string, ContainerAccessProjectionResult>();
  const accessPaths = new Map<string, ContainerAccessPath>();

  const pathResults = await gatherWithExecutor(
    context.executor,
    containerIds,
    async (containerId) => {
      try {
        return {
          accessPath: await loadContainerAccessPath(context, containerId),
          containerId,
        };
      } catch (error) {
        const projectionError = asContainerWriterProjectionError(error);
        if (projectionError) {
          return { containerId, error: projectionError };
        }
        throw error;
      }
    },
  );

  for (const pathResult of pathResults) {
    if ("error" in pathResult) {
      results.set(pathResult.containerId, {
        reason: pathResult.error,
        status: "rejected",
      });
      continue;
    }

    accessPaths.set(pathResult.containerId, pathResult.accessPath);
  }

  let sharedPrincipalPoliciesByReference: Map<
    string,
    VerifiedPrincipalPolicy
  > | null = null;
  if (accessPaths.size > 0) {
    try {
      const sharedPrincipalPolicies = await loadPrincipalPoliciesForAccessPaths(
        context.executor,
        Array.from(
          accessPaths.values(),
          (accessPath) => accessPath.verifiedPath,
        ),
      );
      sharedPrincipalPoliciesByReference = new Map(
        sharedPrincipalPolicies.flatMap((policy) =>
          verifiedPrincipalPolicyReferenceCacheKeys(policy).map(
            (referenceKey) => [referenceKey, policy] as const,
          ),
        ),
      );
    } catch (error) {
      const projectionError = asContainerWriterProjectionError(error);
      if (!projectionError) {
        throw error;
      }
    }
  }

  for (const [containerId, accessPath] of accessPaths) {
    try {
      const principalPolicies = sharedPrincipalPoliciesByReference
        ? principalPoliciesForAccessPath(
            sharedPrincipalPoliciesByReference,
            accessPath,
          )
        : await loadPrincipalPoliciesForAccessPaths(context.executor, [
            accessPath.verifiedPath,
          ]);
      results.set(containerId, {
        status: "fulfilled",
        value: buildContainerAccessProjection({
          accessPath,
          minimumAccessLevel: input.minimumAccessLevel,
          principalPolicies,
          userId: input.userId,
        }),
      });
    } catch (error) {
      const projectionError = asContainerWriterProjectionError(error);
      if (projectionError) {
        results.set(containerId, {
          reason: projectionError,
          status: "rejected",
        });
        continue;
      }
      throw error;
    }
  }

  return results;
}

export async function runContainerWriterProjectionWorkflow(
  db: ApiDatabase,
  input: {
    readonly containerId: string;
    readonly userId: string;
  },
): Promise<ContainerWriterProjectionResponse> {
  return db.transaction((tx) =>
    resolveContainerWriterProjection({
      containerId: input.containerId,
      context: createContainerWriterProjectionContext(tx),
      executor: tx,
      userId: input.userId,
    }),
  );
}
