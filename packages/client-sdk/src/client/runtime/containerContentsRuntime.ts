import {
  type ContainerContentsRootAdopter,
  type ContainerContentsStoreWorkflowRuntime,
  type ContainerContentsWorkflowRuntime,
  type ContainerContentsWorkflowRuntimeInput,
  createContainerContentsWorkflowRuntime as createRuntimeWithHost,
  createContainerContentsStoreWorkflowRuntime as createStoreRuntimeWithHost,
} from "../../workflows/container-contents";
import { containerContentsOrganizationHost } from "../../workflows/organizations/containerContentsHost";

type StandaloneContainerContentsWorkflowRuntimeInput = Omit<
  ContainerContentsWorkflowRuntimeInput,
  "organizations"
>;

type StoreRecipientGuard = Parameters<typeof createStoreRuntimeWithHost>[2];

/** A standalone runtime, bound to the organization workflows' operations. */
export function createContainerContentsWorkflowRuntime(
  input: StandaloneContainerContentsWorkflowRuntimeInput,
): ContainerContentsWorkflowRuntime {
  return createRuntimeWithHost({
    ...input,
    organizations: containerContentsOrganizationHost,
  });
}

/** A standalone store runtime, bound to the organization workflows' operations. */
export function createContainerContentsStoreWorkflowRuntime(
  input: StandaloneContainerContentsWorkflowRuntimeInput,
  adoptRootContainer: ContainerContentsRootAdopter,
  requireVerifiedRecipient: StoreRecipientGuard,
): ContainerContentsStoreWorkflowRuntime {
  return createStoreRuntimeWithHost(
    { ...input, organizations: containerContentsOrganizationHost },
    adoptRootContainer,
    requireVerifiedRecipient,
  );
}
