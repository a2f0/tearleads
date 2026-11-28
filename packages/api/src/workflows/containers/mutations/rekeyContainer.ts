import {
  type ContainerMutationOutcome,
  mutateContainerWithExecutorOutcome,
} from "./shared/mutationRunner";
import type { ContainerMutationHandlerInput } from "./types";

export async function rekeyContainerOutcome(
  input: ContainerMutationHandlerInput,
): Promise<ContainerMutationOutcome> {
  return mutateContainerWithExecutorOutcome({
    ...input,
    expectedEventType: "container.rekey",
  });
}
