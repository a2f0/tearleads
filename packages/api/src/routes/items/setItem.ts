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
    const { payload, encryptedData, spicedbZedToken } = c.req.valid("json");

    const [item] = await db
      .insert(items)
      .values({
        payload,
        encryptedData,
        spicedbZedToken,
      })
      .returning({ id: items.id });

    return c.json({ id: item.id });
  },
);
