import type { MiddlewareHandler } from "hono";
import type { SessionEnv, UserSessionSummary } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";

export interface RootRouterDeps {
  readonly listUserSessions: (input: {
    currentToken: string;
    userId: string;
  }) => Promise<UserSessionSummary[]>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  /** Runs after `requireAuth`; admits only identities flagged `is_root`. */
  readonly requireRoot: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}
