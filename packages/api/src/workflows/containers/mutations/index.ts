import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import type { ContainerMutationResponse } from "@symcrypt/validators/response";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { createContainerWriterProjectionContext } from "../writerProjection";
import { ContainerMutationError, toMutationError } from "./errors";
import { rekeyContainer } from "./rekeyContainer";
import {
  mutateContainerWithExecutor,
  prelockContainerMutationBatch,
} from "./shared/mutationRunner";
import type {
  ApiDatabase,
  ContainerMutationContext,
  MutateContainerInput,
  MutateContainerWithExecutorInput,
} from "./types";

export type { MutateContainerInput };
export { ContainerMutationError };

export async function applyContainerRekeys(input: {
  readonly additionalOrganizationIds?: readonly string[] | undefined;
  readonly executor: MutateContainerWithExecutorInput["executor"];
  readonly fingerprint: string;
  readonly requests?: readonly ContainerMutationRequest[] | undefined;
  readonly userId: string;
}): Promise<void> {
  if (
    (!input.requests || input.requests.length === 0) &&
    (!input.additionalOrganizationIds ||
      input.additionalOrganizationIds.length === 0)
  ) {
    return;
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
  }
}

export async function runContainerMutationWorkflow(
  db: ApiDatabase,
  input: MutateContainerInput,
): Promise<ContainerMutationResponse> {
  try {
    return await db.transaction(async (tx) => {
      const response = await mutateContainerWithExecutor({
        ...input,
        executor: tx,
      });
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
