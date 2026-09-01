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
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export { ContainerMutationError } from "../../workflows/containers/mutations";

export const mutateContainer = createDatabaseWorkflowService<
  MutateContainerInput,
  ContainerMutationResponse
>(runContainerMutationWorkflow);

export const createContainerWithMetadataDocument =
  createDatabaseWorkflowService<
    CreateContainerWithMetadataDocumentInput,
    ContainerCreateWithMetadataDocumentResponse
  >(runCreateContainerWithMetadataDocumentWorkflow);
