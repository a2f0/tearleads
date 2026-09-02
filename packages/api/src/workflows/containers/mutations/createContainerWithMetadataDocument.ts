import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import type { ContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
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

export async function applyContainerSystemSlot(
  db: DatabaseTransaction,
  input: {
    readonly container: ContainerCreateWithMetadataDocumentResponse["container"];
    readonly slot: NonNullable<
      ContainerCreateWithMetadataDocumentRequest["systemSlot"]
    >;
  },
): Promise<ContainerCreateWithMetadataDocumentResponse["container"]> {
  if (input.container.parentId === null) {
    throw new ContainerMutationError(
      "System container parent must be the root container",
      400,
    );
  }

  const [parent] = await db
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, input.container.parentId))
    .limit(1);
  if (!parent || parent.parentId !== null) {
    throw new ContainerMutationError(
      "System container parent must be the root container",
      400,
    );
  }
  if (parent.organizationId !== input.container.organizationId) {
    throw new ContainerMutationError(
      "System container organization mismatch",
      409,
    );
  }

  const [existing] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, input.container.organizationId),
        eq(containers.systemSlot, input.slot),
      ),
    )
    .limit(1);
  if (existing && existing.id !== input.container.containerId) {
    throw new ContainerMutationError("System container already exists", 409);
  }

  const [updated] = await db
    .update(containers)
    .set({ systemSlot: input.slot })
    .where(eq(containers.id, input.container.containerId))
    .returning({ systemSlot: containers.systemSlot });
  if (!updated) {
    throw new ContainerMutationError("Container not found", 404);
  }

  return {
    ...input.container,
    systemSlot: input.slot,
  };
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

      const systemSlot = input.request.systemSlot ?? null;
      const nextContainer = systemSlot
        ? await applyContainerSystemSlot(tx, {
            container,
            slot: systemSlot,
          })
        : container;

      await assertOrganizationCanSync(
        tx,
        nextContainer.organizationId,
        input.userId,
      );

      return { container: nextContainer, metadataDocument };
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
