import { isShareContainerRequest } from "@tearleads/validators/request";
import type { ShareContainerResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  canAdminContainerAccess,
  grantContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { requireAuth } from "../../middleware/session";
import { containerMetadataDocuments, containers } from "../../schema";

class ShareContainerError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export const shareContainerRoute = new Hono();

shareContainerRoute.post(
  "/containers/:containerId/share",
  requireAuth,
  validator("json", (value, c) => {
    if (!isShareContainerRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const session = c.get("session");
    const containerId = c.req.param("containerId");
    const { accessLevel, subjectId, subjectType } = c.req.valid("json");

    try {
      const shared = await db.transaction(async (tx) => {
        const [container] = await tx
          .select({ id: containers.id })
          .from(containers)
          .where(eq(containers.id, containerId))
          .limit(1);

        if (!container) {
          throw new ShareContainerError("Container not found", 404);
        }

        const containerAccess = await resolveContainerAccessState(
          containerId,
          tx,
        );

        if (!containerAccess) {
          throw new ShareContainerError(
            "Container access state is unavailable",
            409,
          );
        }

        if (!canAdminContainerAccess(containerAccess, session.userId)) {
          throw new ShareContainerError("Forbidden", 403);
        }

        await grantContainerAccess(
          {
            accessLevel,
            containerId,
            subjectId,
            subjectType,
          },
          tx,
        );

        const [metadataBinding] = await tx
          .select({ documentId: containerMetadataDocuments.documentId })
          .from(containerMetadataDocuments)
          .where(eq(containerMetadataDocuments.containerId, containerId))
          .limit(1);

        if (!metadataBinding) {
          throw new ShareContainerError(
            "Container metadata document not found",
            409,
          );
        }

        const metadataAccess = await resolveDocumentAccessState(
          metadataBinding.documentId,
          tx,
        );

        if (!metadataAccess) {
          throw new ShareContainerError(
            "Container metadata access state is unavailable",
            409,
          );
        }

        return {
          id: containerId,
          metadataDocumentId: metadataBinding.documentId,
          metadataAccessEpoch: metadataAccess.currentAccessEpoch,
          metadataRecipientEncapsulationPublicKeys:
            listRecipientEncapsulationPublicKeys(metadataAccess),
        };
      });

      return c.json<ShareContainerResponse>(shared);
    } catch (error) {
      if (error instanceof ShareContainerError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
