import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../adapters/postgres";
import { requireAuth } from "../../middleware/session";
import { users } from "../../schema";

export const encapsulationKeyRoute = new Hono();

encapsulationKeyRoute.get(
  "/auth/encapsulation-key/:userId",
  requireAuth,
  async (c) => {
    const userId = c.req.param("userId");

    const [user] = await db
      .select({ encapsulationPublicKey: users.encapsulationPublicKey })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json({
      userId,
      encapsulationPublicKey: user.encapsulationPublicKey,
    });
  },
);
