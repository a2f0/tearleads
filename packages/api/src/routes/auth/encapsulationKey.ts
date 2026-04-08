import { Hono } from "hono";
import { requireAuth } from "../../middleware/session";
import {
  GetEncapsulationKeyError,
  getEncapsulationKey,
} from "../../services/auth/getEncapsulationKey";
import { defaultApiServiceRuntime } from "../../services/runtime";

export const encapsulationKeyRoute = new Hono();

encapsulationKeyRoute.get(
  "/auth/encapsulation-key/:userId",
  requireAuth,
  async (c) => {
    const userId = c.req.param("userId");

    try {
      return c.json(
        await getEncapsulationKey(defaultApiServiceRuntime, userId),
      );
    } catch (error) {
      if (error instanceof GetEncapsulationKeyError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
