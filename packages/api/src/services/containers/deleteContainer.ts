import type { ContainerDeleteResponse } from "@symcrypt/validators/response";
import {
  DeleteContainerError,
  deleteContainer as runDeleteContainerWorkflow,
} from "../../workflows/containers/deleteContainer";
import type { ApiServiceRuntime } from "../runtime";

export { DeleteContainerError };

export function deleteContainer(
  runtime: ApiServiceRuntime,
  input: {
    readonly containerId: string;
    readonly userId: string;
  },
): Promise<ContainerDeleteResponse> {
  return runDeleteContainerWorkflow(runtime.db, input);
}
