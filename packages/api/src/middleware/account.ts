import { createMiddleware } from "hono/factory";
import {
  accountCanUsePaidFeatures,
  serializeAccountLifecycle,
} from "../accounts/lifecycle";
import { resolveAccountLifecycle } from "../services/accounts/lifecycle";
import type { ApiServiceRuntime } from "../services/runtime";
import type { SessionEnv } from "./session";

export function createRequirePaidAccount(runtime: ApiServiceRuntime) {
  return createMiddleware<SessionEnv>(async (c, next) => {
    const session = c.get("session");
    const account = await resolveAccountLifecycle(runtime, session.userId);

    if (!accountCanUsePaidFeatures(account.status)) {
      return c.json(
        {
          error: "Account is disabled",
          account: serializeAccountLifecycle(account),
        },
        402,
      );
    }

    return next();
  });
}
