import { isSetItemRequest } from "@tearleads/validators/request";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { db } from "../../adapters/postgres";
import { requireAuth } from "../../middleware/session";
import { items } from "../../schema";

export const setItemRoute = new Hono();

setItemRoute.post(
  "/items",
  requireAuth,
  validator("json", (value, c) => {
    if (!isSetItemRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }
    return value;
  }),
  async (c) => {
    const { encryptedData } = c.req.valid("json");

    const [item] = await db
      .insert(items)
      .values({
        encryptedData,
        spicedbZedToken: null,
      })
      .returning({ id: items.id });

    if (!item) {
      return c.json({ error: "Failed to create item" }, 500);
    }

    return c.json({ id: item.id });
  },
);
