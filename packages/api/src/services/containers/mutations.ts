import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerMutationResponse,
} from "@tearleads/validators/response";
import {
  type MutateContainerInput,
  runContainerMutationWorkflow,
} from "../../workflows/containers/mutations";
import {
  type CreateContainerWithMetadataDocumentInput,
  runCreateContainerWithMetadataDocumentWorkflow,
} from "../../workflows/containers/mutations/createContainerWithMetadataDocument";
import type { ApiServiceRuntime } from "../runtime";

export { ContainerMutationError } from "../../workflows/containers/mutations";

export async function mutateContainer(
  runtime: ApiServiceRuntime,
  input: MutateContainerInput,
): Promise<ContainerMutationResponse> {
  return runContainerMutationWorkflow(runtime.db, input);
}

export async function createContainerWithMetadataDocument(
  runtime: ApiServiceRuntime,
  input: CreateContainerWithMetadataDocumentInput,
): Promise<ContainerCreateWithMetadataDocumentResponse> {
  return runCreateContainerWithMetadataDocumentWorkflow(runtime.db, input);
}
