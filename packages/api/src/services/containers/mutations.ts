import type { ContainerMutationResponse } from "@tearleads/validators/response";
import {
  type MutateContainerInput,
  runContainerMutationWorkflow,
} from "../../workflows/containers/mutations";
import type { ApiServiceRuntime } from "../runtime";

export {
  applyContainerRekeys,
  ContainerMutationError,
} from "../../workflows/containers/mutations";

export async function mutateContainer(
  runtime: ApiServiceRuntime,
  input: MutateContainerInput,
): Promise<ContainerMutationResponse> {
  return runContainerMutationWorkflow(runtime.db, input);
}
