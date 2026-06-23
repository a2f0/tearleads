import type { Context, MiddlewareHandler } from "hono";
import {
  destroySession as defaultDestroySession,
  destroyUserSession as defaultDestroyUserSession,
  listUserSessions as defaultListUserSessions,
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "./middleware/session";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "./services/runtime";

// Test seam
export interface RouteAppOverrides {
  readonly destroySession?: (c: Context) => Promise<void>;
  readonly destroyUserSession?: typeof defaultDestroyUserSession;
  readonly listUserSessions?: typeof defaultListUserSessions;
  readonly publish?: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

type ResolvedRouteAppDeps = Required<RouteAppOverrides>;

export const productionRouteAppOverrides: RouteAppOverrides = {
  destroySession: defaultDestroySession,
  destroyUserSession: defaultDestroyUserSession,
  listUserSessions: defaultListUserSessions,
  requireAuth: defaultRequireAuth,
  runtime: defaultApiServiceRuntime,
};

export function resolveRouteAppDeps({
  destroySession,
  destroyUserSession,
  listUserSessions,
  publish,
  requireAuth,
  runtime,
}: RouteAppOverrides): ResolvedRouteAppDeps {
  const runtimeBase = runtime ?? defaultApiServiceRuntime;
  const resolvedPublish = publish ?? runtimeBase.eventPublisher.publish;
  const resolvedRuntime =
    publish === undefined
      ? runtimeBase
      : {
          ...runtimeBase,
          eventPublisher: {
            ...runtimeBase.eventPublisher,
            publish: resolvedPublish,
          },
        };
  return {
    destroySession: destroySession ?? defaultDestroySession,
    destroyUserSession: destroyUserSession ?? defaultDestroyUserSession,
    listUserSessions: listUserSessions ?? defaultListUserSessions,
    publish: resolvedPublish,
    requireAuth: requireAuth ?? defaultRequireAuth,
    runtime: resolvedRuntime,
  };
}
