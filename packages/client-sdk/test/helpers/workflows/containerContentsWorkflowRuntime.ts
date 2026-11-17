import {
  type ContainerContentsWorkflowRuntime,
  type ContainerContentsWorkflowRuntimeInput,
  createContainerContentsWorkflowRuntime as createRuntimeWithHost,
} from "../../../src/workflows/container-contents/runtime";
import { containerContentsOrganizationHost } from "../../../src/workflows/organizations/containerContentsHost";

/**
 * A container-contents runtime bound to the organization workflows, as
 * client/runtime/containerContentsRuntime binds it, without loading the
 * client tier into workflow tests.
 */
export function createContainerContentsWorkflowRuntime(
  input: Omit<ContainerContentsWorkflowRuntimeInput, "organizations">,
): ContainerContentsWorkflowRuntime {
  return createRuntimeWithHost({
    ...input,
    organizations: containerContentsOrganizationHost,
  });
}
