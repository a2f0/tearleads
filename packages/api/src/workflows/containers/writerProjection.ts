import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  ContainerAccessLevel,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { uniqueSortedStrings } from "../../utils/array";
import {
  asContainerWriterProjectionError,
  buildContainerAccessProjection,
  loadContainerAccessPath,
  principalPoliciesForAccessPath,
  resolveSingleContainerAccessProjection,
} from "./writerProjection/accessPaths";
import { createContainerWriterProjectionContext } from "./writerProjection/context";
import { loadContainerKekState } from "./writerProjection/kek";
import { loadContainerKekKeyring } from "./writerProjection/keyringDelivery";
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
    throw new ContainerWriterProjectionError(
      "Container not found",
      404,
      CONTAINER_NOT_FOUND_ERROR_CODE,
    );
  }

  // Current access is history-inclusive. Each path KEK carries the sealed
  // keyring for its epoch; opening it under the current KEK yields every
  // retained historical KEK without a chain walk. Descendants are verified
  // against their parent's CURRENT epoch (lazy rekey must materialize a
  // post-change descendant epoch before writes), so no historical parent
  // epoch RECORD is ever part of a served path — but the historical parent
  // KEY still is, via the keyring, and a descendant pinned to a pre-rotation
  // parent epoch is opened with it. That is what keeps a lazy rekey
  // performable instead of stranding the subtree.
  const containerKeks: ContainerWriterProjectionResponse["containerKeks"] = [];
  for (const index of access.verifiedPath.keys()) {
    const kekState = containerKekStates[index];
    if (!kekState) {
      throw new ContainerWriterProjectionError("Container KEK missing", 409);
    }
    const keyring = await loadContainerKekKeyring({
      containerKeyEpochId: kekState.state.containerKeyEpochId,
      context,
    });
    containerKeks.push(containerKekResponse(kekState, keyring));
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
  readonly userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  return resolveContainerProjectionWithAccess({
    ...input,
    minimumAccessLevel: "read",
  });
}

async function resolveContainerWriterProjection(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseSession;
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
  const containerIds = uniqueSortedStrings(input.containerIds);
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
