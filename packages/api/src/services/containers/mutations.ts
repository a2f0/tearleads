import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerReciteResponse,
} from "@tearleads/validators/response";
import {
  type ContainerRotationOutcome,
  type MutateContainerRotationInput,
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
  MutateContainerRotationInput,
  ContainerRotationOutcome
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
