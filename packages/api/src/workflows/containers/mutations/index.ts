import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { assertOrganizationCanSync } from "../../billing/organizationBilling";
import { createContainer } from "./createContainer";
import { ContainerMutationError, toMutationError } from "./errors";
import { grantContainerAccess } from "./grantContainerAccess";
import { moveContainer } from "./moveContainer";
import { rekeyContainer } from "./rekeyContainer";
import { revokeContainerAccess } from "./revokeContainerAccess";
import { mutateContainerWithExecutor } from "./shared/mutationRunner";
import type {
  ApiDatabase,
  ContainerMutationContext,
  MutateContainerInput,
  MutateContainerWithExecutorInput,
} from "./types";

export type { MutateContainerInput };
export { ContainerMutationError };

async function mutateContainerByEventType(
  input: MutateContainerWithExecutorInput,
): Promise<ContainerMutationResponse> {
  const handlerInput = {
    executor: input.executor,
    fingerprint: input.fingerprint,
    request: input.request,
    userId: input.userId,
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.expectedContainerId !== undefined
      ? { expectedContainerId: input.expectedContainerId }
      : {}),
  };

  switch (input.expectedEventType) {
    case "container.create":
      return createContainer(handlerInput);
    case "container.grant":
      return grantContainerAccess(handlerInput);
    case "container.move":
      return moveContainer(handlerInput);
    case "container.rekey":
      return rekeyContainer(handlerInput);
    case "container.revoke":
      return revokeContainerAccess(handlerInput);
    default:
      return mutateContainerWithExecutor(input);
  }
}

export async function applyContainerRekeys(input: {
  readonly executor: MutateContainerWithExecutorInput["executor"];
  readonly fingerprint: string;
  readonly requests?: readonly ContainerMutationRequest[] | undefined;
  readonly userId: string;
}): Promise<void> {
  if (!input.requests || input.requests.length === 0) {
    return;
  }

  // Document/blob writes call this before resolving current container heads and
  // KEK targets. A retry can carry the same signed container.rekey that would
  // have gone through /rekey, then validate the actual write against the new
  // head in this transaction; if the write later fails, the rekey rolls back too.
  const context: ContainerMutationContext = {
    executor: input.executor,
    manifestHeadByContainerId: new Map(),
  };

  for (const request of input.requests) {
    const response = await rekeyContainer({
      context,
      executor: input.executor,
      fingerprint: input.fingerprint,
      request,
      userId: input.userId,
    });
    await assertOrganizationCanSync(input.executor, response.organizationId);
  }
}

export async function runContainerMutationWorkflow(
  db: ApiDatabase,
  input: MutateContainerInput,
): Promise<ContainerMutationResponse> {
  try {
    return await db.transaction(async (tx) => {
      const response = await mutateContainerByEventType({
        ...input,
        executor: tx,
      });
      // Public mutation boundary (registration bootstraps its own org via the
      // lower-level handlers directly, so it is not gated here).
      await assertOrganizationCanSync(tx, response.organizationId);
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
