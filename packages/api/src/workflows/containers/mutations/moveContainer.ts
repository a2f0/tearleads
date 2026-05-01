import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { mutateContainerWithExecutor } from "./shared/mutationRunner";
import type { ContainerMutationHandlerInput } from "./types";

export async function moveContainer(
  input: ContainerMutationHandlerInput,
): Promise<ContainerMutationResponse> {
  return mutateContainerWithExecutor({
    ...input,
    expectedEventType: "container.move",
  });
}
