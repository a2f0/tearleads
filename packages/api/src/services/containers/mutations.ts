import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerMutationResponse,
  ContainerReciteResponse,
} from "@tearleads/validators/response";
import {
  type MutateContainerInput,
  runContainerMutationWorkflow,
} from "../../workflows/containers/mutations";
import {
  type CreateContainerWithMetadataDocumentInput,
  runCreateContainerWithMetadataDocumentWorkflow,
} from "../../workflows/containers/mutations/createContainerWithMetadataDocument";
import {
  type ReciteContainerInput,
  runReciteContainerWorkflow,
} from "../../workflows/containers/mutations/reciteContainer";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";

export { ContainerMutationError } from "../../workflows/containers/mutations";

export const mutateContainer = createDatabaseWorkflowService<
  MutateContainerInput,
  ContainerMutationResponse
>(runContainerMutationWorkflow);

export const reciteContainer = createDatabaseWorkflowService<
  ReciteContainerInput,
  ContainerReciteResponse
>(runReciteContainerWorkflow);

export const createContainerWithMetadataDocument =
  createDatabaseWorkflowService<
    CreateContainerWithMetadataDocumentInput,
    ContainerCreateWithMetadataDocumentResponse
  >(runCreateContainerWithMetadataDocumentWorkflow);
