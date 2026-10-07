import {
  getProjectionPolicyHistoryOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { Hono, MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getProjectionPolicyHistory } from "../../services/principals/getProjectionPolicyHistory";
import {
  PrincipalHistoryContinuation,
  PrincipalPolicyError,
} from "../../services/principals/shared";
import type { ApiServiceRuntime } from "../../services/runtime";
import { queryParamsValidator } from "../../validators/queryParams";

export function registerProjectionPolicyHistoryRoute(
  route: Hono<SessionEnv>,
  {
    requireAuth,
    runtime,
  }: {
    readonly requireAuth: MiddlewareHandler<SessionEnv>;
    readonly runtime: ApiServiceRuntime;
  },
): void {
  route.on(
    getProjectionPolicyHistoryOperation.method,
    operationRoutePath(getProjectionPolicyHistoryOperation),
    requireAuth,
    queryParamsValidator(getProjectionPolicyHistoryOperation.query),
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      try {
        return c.json(
          await getProjectionPolicyHistory(runtime, {
            ...c.req.valid("query"),
            requesterUserId: c.get("session").userId,
          }),
        );
      } catch (error) {
        if (error instanceof PrincipalHistoryContinuation)
          return c.json(
            {
              code: error.code,
              committed: false,
              progressToken: error.progressToken,
            },
            202,
          );
        if (error instanceof PrincipalPolicyError)
          return c.json({ error: error.message }, error.status);
        throw error;
      }
    },
  );
}
