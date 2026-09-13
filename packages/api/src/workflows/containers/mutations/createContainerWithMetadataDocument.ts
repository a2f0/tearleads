import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import type { ContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
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

export function readContainerMetadataDocumentId(
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

/** The mutation verifier already enforces signed root-child and admin authority. */
export function assertContainerSystemSlot(
  container: ContainerCreateWithMetadataDocumentResponse["container"],
  slot: string | null,
): void {
  if ((container.systemSlot ?? null) !== slot) {
    throw new ContainerMutationError(
      "System slot does not match the signed container state",
      400,
    );
  }
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
      assertContainerSystemSlot(container, input.request.systemSlot ?? null);
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

      await assertOrganizationCanSync(
        tx,
        container.organizationId,
        input.userId,
      );

      return { container, metadataDocument };
    });
  } catch (error) {
    const containerMutationError = toMutationError(error);
    if (containerMutationError) {
      throw containerMutationError;
    }
    // The metadata-document write can fail with a documents-domain error;
    // surface it as a ContainerMutationError so callers of the container
    // workflow only ever deal with the container error type.
    if (error instanceof DocumentMutationError) {
      throw new ContainerMutationError(error.message, error.status, {
        ...(error.code === undefined ? {} : { code: error.code }),
        error: error.message,
      });
    }

    throw error;
  }
}
