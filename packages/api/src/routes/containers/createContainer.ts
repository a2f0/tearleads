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

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CreateContainerError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
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
    const { id, parentId, name } = c.req.valid("json");
    const trimmedName = name.trim();

    if (!UUID_V4_REGEX.test(id)) {
      return c.json({ error: "Invalid id: must be a valid UUIDv4" }, 400);
    }

    if (!UUID_V4_REGEX.test(parentId)) {
      return c.json({ error: "Invalid parentId: must be a valid UUIDv4" }, 400);
    }

    if (trimmedName.length === 0) {
      return c.json({ error: "Container name is required" }, 400);
    }

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
            name: trimmedName,
          })
          .onConflictDoNothing({ target: containers.id })
          .returning({
            id: containers.id,
            organizationId: containers.organizationId,
            parentId: containers.parentId,
            name: containers.name,
          });

        if (!container) {
          throw new CreateContainerError("Container already exists", 409);
        }

        await initializeContainerAccess(container.id, tx);

        return {
          id: container.id,
          organizationId: container.organizationId,
          parentId: container.parentId ?? parent.id,
          name: container.name,
        };
      });

      return c.json<CreateContainerResponse>(created);
    } catch (error) {
      if (error instanceof CreateContainerError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
