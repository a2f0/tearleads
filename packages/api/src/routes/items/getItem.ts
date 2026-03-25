import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../adapters/postgres";
import { requireAuth } from "../../middleware/session";
import { items } from "../../schema";

export const getItemRoute = new Hono();

getItemRoute.get("/items/:itemId", requireAuth, async (c) => {
  const itemId = c.req.param("itemId");

  const [item] = await db.select().from(items).where(eq(items.id, itemId));

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  return c.json({
    id: item.id,
    payload: item.payload,
    encryptedData: item.encryptedData,
    spicedbZedToken: item.spicedbZedToken,
    createdAt: item.createdAt,
  });
});
