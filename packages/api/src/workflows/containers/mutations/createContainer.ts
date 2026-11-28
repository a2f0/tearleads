import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { mutateContainerWithExecutorOutcome } from "./shared/mutationRunner";
import type { ContainerMutationHandlerInput } from "./types";

/**
 * The acknowledgement carries no signed state, so callers that pair the
 * container with its metadata document read the id from the verified state.
 */
export async function createContainerOutcome(
  input: ContainerMutationHandlerInput,
): Promise<{
  readonly ancestorIds: readonly string[];
  readonly metadataDocumentId: string;
  readonly response: ContainerMutationResponse;
}> {
  const outcome = await mutateContainerWithExecutorOutcome({
    ...input,
    expectedEventType: "container.create",
  });
  return {
    ancestorIds: outcome.ancestorIds,
    metadataDocumentId: outcome.metadataDocumentId,
    response: outcome.response,
  };
}
