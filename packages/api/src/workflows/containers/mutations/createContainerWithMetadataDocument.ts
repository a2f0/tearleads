import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import type { ContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import type { DatabaseTransaction } from "../../../adapters/postgres";
import { containers } from "../../../schema";
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

async function applyContainerBuiltinKind(
  db: DatabaseTransaction,
  input: {
    readonly container: ContainerCreateWithMetadataDocumentResponse["container"];
    readonly kind: NonNullable<
      ContainerCreateWithMetadataDocumentRequest["builtinKind"]
    >;
  },
): Promise<ContainerCreateWithMetadataDocumentResponse["container"]> {
  if (input.container.parentId === null) {
    throw new ContainerMutationError(
      "Built-in container parent must be the root container",
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
      "Built-in container parent must be the root container",
      400,
    );
  }
  if (parent.organizationId !== input.container.organizationId) {
    throw new ContainerMutationError(
      "Built-in container organization mismatch",
      409,
    );
  }

  const [existing] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, input.container.organizationId),
        eq(containers.builtinKind, input.kind),
      ),
    )
    .limit(1);
  if (existing && existing.id !== input.container.containerId) {
    throw new ContainerMutationError("Built-in container already exists", 409);
  }

  const [updated] = await db
    .update(containers)
    .set({ builtinKind: input.kind })
    .where(eq(containers.id, input.container.containerId))
    .returning({ builtinKind: containers.builtinKind });
  if (!updated) {
    throw new ContainerMutationError("Container not found", 404);
  }

  return {
    ...input.container,
    builtinKind: input.kind,
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

      const builtinKind = input.request.builtinKind ?? null;
      const nextContainer = builtinKind
        ? await applyContainerBuiltinKind(tx, {
            container,
            kind: builtinKind,
          })
        : container;

      return { container: nextContainer, metadataDocument };
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
