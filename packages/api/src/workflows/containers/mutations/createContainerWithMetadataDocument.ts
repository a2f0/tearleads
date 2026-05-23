import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import type { ContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { createDocumentWithExecutor } from "../../documents/mutations/createDocument";
import { DocumentMutationError } from "../../documents/mutations/errors";
import { createContainer } from "./createContainer";
import { ContainerMutationError, toMutationError } from "./errors";
import type { ApiDatabase } from "./types";

export interface CreateContainerWithMetadataDocumentInput {
  readonly fingerprint: string;
  readonly request: ContainerCreateWithMetadataDocumentRequest;
  readonly userId: string;
}

function readContainerMetadataDocumentId(
  response: ContainerCreateWithMetadataDocumentResponse["container"],
): string {
  const metadataDocumentId = Reflect.get(
    response.accessManifest.state,
    "metadataDocumentId",
  );
  if (
    typeof metadataDocumentId !== "string" ||
    metadataDocumentId.length === 0
  ) {
    throw new ContainerMutationError(
      "Container create response is missing metadata document state",
      400,
    );
  }

  return metadataDocumentId;
}

export async function runCreateContainerWithMetadataDocumentWorkflow(
  db: ApiDatabase,
  input: CreateContainerWithMetadataDocumentInput,
): Promise<ContainerCreateWithMetadataDocumentResponse> {
  try {
    return await db.transaction(async (tx) => {
      const container = await createContainer({
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request.container,
        userId: input.userId,
      });
      const metadataDocumentId = readContainerMetadataDocumentId(container);

      const metadataDocument = await createDocumentWithExecutor({
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request.metadataDocument,
        userId: input.userId,
      });
      if (metadataDocument.id !== metadataDocumentId) {
        throw new ContainerMutationError(
          "Metadata document does not match container metadata state",
          400,
        );
      }

      return { container, metadataDocument };
    });
  } catch (error) {
    const containerMutationError = toMutationError(error);
    if (containerMutationError) {
      throw containerMutationError;
    }
    if (error instanceof DocumentMutationError) {
      throw error;
    }

    throw error;
  }
}
