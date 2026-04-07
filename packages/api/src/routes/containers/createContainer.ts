import { isCreateContainerRequest } from "@tearleads/validators/request";
import type { CreateContainerResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  canWriteContainerAccess,
  initializeContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import { db } from "../../adapters/postgres";
import { requireAuth } from "../../middleware/session";
import { containers } from "../../schema";
import {
  ContainerMetadataError,
  createContainerMetadataDocument,
} from "./containerMetadata";

class CreateContainerError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export const createContainerRoute = new Hono();

createContainerRoute.post(
  "/containers",
  requireAuth,
  validator("json", (value, c) => {
    if (!isCreateContainerRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const session = c.get("session");
    const {
      id,
      initialMetadataRecipientEnvelopes,
      initialMetadataUpdates,
      parentId,
    } = c.req.valid("json");

    try {
      const created = await db.transaction(async (tx) => {
        const [parent] = await tx
          .select({
            id: containers.id,
            organizationId: containers.organizationId,
          })
          .from(containers)
          .where(eq(containers.id, parentId))
          .limit(1);

        if (!parent) {
          throw new CreateContainerError("Parent container not found", 404);
        }

        const parentAccess = await resolveContainerAccessState(parent.id, tx);
        if (!parentAccess) {
          throw new CreateContainerError(
            "Parent container access is unavailable",
            409,
          );
        }

        if (!canWriteContainerAccess(parentAccess, session.userId)) {
          throw new CreateContainerError("Forbidden", 403);
        }

        const [container] = await tx
          .insert(containers)
          .values({
            id,
            organizationId: parent.organizationId,
            parentId: parent.id,
          })
          .onConflictDoNothing({ target: containers.id })
          .returning({
            id: containers.id,
            organizationId: containers.organizationId,
            parentId: containers.parentId,
          });

        if (!container) {
          throw new CreateContainerError("Container already exists", 409);
        }

        await initializeContainerAccess(container.id, tx, {
          inheritedFrom: parentAccess,
        });

        const metadata = await createContainerMetadataDocument(tx, {
          authorFingerprint: session.fingerprint,
          containerId: container.id,
          createdByFingerprint: session.fingerprint,
          initialMetadataUpdates,
          ...(initialMetadataRecipientEnvelopes
            ? { initialMetadataRecipientEnvelopes }
            : {}),
        });

        return {
          id: container.id,
          organizationId: container.organizationId,
          parentId: container.parentId ?? parent.id,
          metadataAccessEpoch: metadata.metadataAccessEpoch,
          metadataDocumentId: metadata.metadataDocumentId,
          metadataRecipientEncapsulationPublicKeys:
            metadata.metadataRecipientEncapsulationPublicKeys,
        };
      });

      return c.json<CreateContainerResponse>(created);
    } catch (error) {
      if (error instanceof CreateContainerError) {
        return c.json({ error: error.message }, error.status);
      }

      if (error instanceof ContainerMetadataError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
