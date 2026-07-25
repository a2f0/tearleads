import {
  type ContainerContentsWorkflowRuntimeInput,
  createContainerContentsStoreWorkflowRuntime,
} from "../../workflows/container-contents/runtime";

export function createContainerContentsStoreTestRuntime(
  input: ContainerContentsWorkflowRuntimeInput,
) {
  return createContainerContentsStoreWorkflowRuntime(input, () => false);
}
