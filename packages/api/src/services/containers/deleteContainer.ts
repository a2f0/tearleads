import {
  DeleteContainerError,
  type DeleteContainerOutcome,
  deleteContainer as runDeleteContainerWorkflow,
} from "../../workflows/containers/deleteContainer";
import type { ApiServiceRuntime } from "../runtime";

export { DeleteContainerError };

export function deleteContainer(
  runtime: ApiServiceRuntime,
  input: {
    readonly containerId: string;
    readonly requiredAncestorId?: string | undefined;
    readonly userId: string;
  },
): Promise<DeleteContainerOutcome> {
  return runDeleteContainerWorkflow(runtime.db, input);
}
