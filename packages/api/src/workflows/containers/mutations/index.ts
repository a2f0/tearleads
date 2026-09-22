import type { AccessEventType } from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  ContainerRotationResponse,
} from "@tearleads/validators/response";
import {
  MAX_INLINE_CONTAINER_REKEYS,
  MAX_ROTATION_CONTAINER_REKEYS,
} from "@tearleads/validators/util";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { createContainerWriterProjectionContext } from "../writerProjection";
import {
  ContainerMutationError,
  mutationShapeError,
  toMutationError,
} from "./errors";
import { rekeyContainer } from "./rekeyContainer";
import { assertGrantedPathsCurrentBelowRotations } from "./shared/grantedPathCurrency";
import {
  mutateContainerWithExecutor,
  prelockContainerMutationBatch,
} from "./shared/mutationRunner";
import type {
  ApiDatabase,
  ContainerMutationContext,
  MutateContainerInput,
  MutateContainerRotationInput,
  MutateContainerWithExecutorInput,
} from "./types";

export { assertContainerPathEdges } from "./shared/manifests";
export type { MutateContainerRotationInput };
export { ContainerMutationError };

export interface AppliedContainerRekey {
  readonly request: ContainerMutationRequest;
  readonly response: ContainerMutationResponse;
}

export async function applyContainerRekeys(input: {
  readonly additionalOrganizationIds?: readonly string[] | undefined;
  readonly executor: MutateContainerWithExecutorInput["executor"];
  readonly fingerprint: string;
  readonly requests?: readonly ContainerMutationRequest[] | undefined;
  readonly userId: string;
}): Promise<AppliedContainerRekey[]> {
  if (
    (!input.requests || input.requests.length === 0) &&
    (!input.additionalOrganizationIds ||
      input.additionalOrganizationIds.length === 0)
  ) {
    return [];
  }

  // Document/blob writes call this before resolving current container heads and
  // KEK targets. A retry can carry the same signed container.rekey that would
  // have gone through /rekey, then validate the actual write against the new
  // head in this transaction; if the write later fails, the rekey rolls back too.
  const context: ContainerMutationContext = {
    executor: input.executor,
    manifestHeadByContainerId: new Map(),
    verifiedManifestByHash: new Map(),
    writerProjectionContext: createContainerWriterProjectionContext(
      input.executor,
    ),
  };
  await prelockContainerMutationBatch(
    context,
    (input.requests ?? []).map((request) => ({
      expectedEventType: "container.rekey",
      fingerprint: input.fingerprint,
      request,
      userId: input.userId,
    })),
    input.additionalOrganizationIds,
  );

  const applied: AppliedContainerRekey[] = [];
  for (const request of input.requests ?? []) {
    const response = await rekeyContainer({
      context,
      executor: input.executor,
      fingerprint: input.fingerprint,
      request,
      userId: input.userId,
    });
    await assertOrganizationCanSync(
      input.executor,
      response.organizationId,
      input.userId,
    );
    applied.push({ request, response });
  }
  // An inline repair is a rotation like any other. The write that carries it
  // holds a flat list, so the descendants it strands ride as further entries.
  await assertGrantedPathsCurrentBelowRotations({
    carriedLimit: MAX_INLINE_CONTAINER_REKEYS,
    executor: input.executor,
    rotated: applied.map(({ response }) => response),
  });
  return applied;
}

/** Event types that mint a new key epoch and so re-stale every descendant. */
const ROTATING_EVENT_TYPES: ReadonlySet<AccessEventType> =
  new Set<AccessEventType>([
    "container.move",
    "container.rekey",
    "container.revoke",
  ]);

/**
 * One rotation and the descendant rekeys it carries, in one transaction. The
 * carried rekeys apply after the rotation, parent-first, so each pins the epoch
 * its parent was just given; then nothing above a directly granted container
 * may be left stale, or the whole rotation rolls back.
 */
async function mutateContainerRotationInTransaction(
  tx: MutateContainerWithExecutorInput["executor"],
  input: MutateContainerRotationInput,
): Promise<ContainerRotationResponse> {
  const { containerRekeys = [], ...request } = input.request;
  const rotates = ROTATING_EVENT_TYPES.has(input.expectedEventType);
  // Create and share validate with the loose mutation schema, which keeps
  // unknown keys, so this one can arrive as anything at all.
  if (!Array.isArray(containerRekeys)) {
    throw mutationShapeError("Container rekeys must be a list");
  }
  if (containerRekeys.length > 0 && !rotates) {
    throw mutationShapeError("Only a rotation may carry container rekeys");
  }
  const target: MutateContainerInput = { ...input, request };
  if (containerRekeys.length === 0) {
    const response = await mutateContainerWithExecutor({
      ...target,
      executor: tx,
    });
    if (rotates) {
      await assertGrantedPathsCurrentBelowRotations({
        carriedLimit: MAX_ROTATION_CONTAINER_REKEYS,
        executor: tx,
        rotated: [response],
      });
    }
    return response;
  }

  const carried = containerRekeys.map(
    (carriedRequest): MutateContainerInput => ({
      expectedEventType: "container.rekey",
      fingerprint: input.fingerprint,
      request: carriedRequest,
      userId: input.userId,
    }),
  );
  // One prelock over the whole batch keeps the group -> organization lock
  // order deterministic, exactly as inline document rekeys do.
  const context: ContainerMutationContext = {
    executor: tx,
    manifestHeadByContainerId: new Map(),
    verifiedManifestByHash: new Map(),
    writerProjectionContext: createContainerWriterProjectionContext(tx),
  };
  await prelockContainerMutationBatch(context, [target, ...carried]);
  const response = await mutateContainerWithExecutor({
    ...target,
    context,
    executor: tx,
  });
  const carriedResponses: ContainerMutationResponse[] = [];
  for (const carriedInput of carried) {
    carriedResponses.push(
      await rekeyContainer({
        context,
        executor: tx,
        fingerprint: carriedInput.fingerprint,
        request: carriedInput.request,
        userId: carriedInput.userId,
      }),
    );
  }
  await assertGrantedPathsCurrentBelowRotations({
    carriedLimit: MAX_ROTATION_CONTAINER_REKEYS,
    executor: tx,
    rotated: [response, ...carriedResponses],
  });
  return { ...response, containerRekeys: carriedResponses };
}

export async function runContainerMutationWorkflow(
  db: ApiDatabase,
  input: MutateContainerRotationInput,
): Promise<ContainerRotationResponse> {
  try {
    return await db.transaction(async (tx) => {
      const response = await mutateContainerRotationInTransaction(tx, input);
      // Public mutation boundary (registration bootstraps its own org via the
      // lower-level handlers directly, so it is not gated here).
      await assertOrganizationCanSync(
        tx,
        response.organizationId,
        input.userId,
      );
      return response;
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }

    throw error;
  }
}
