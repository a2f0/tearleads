import type { Context, MiddlewareHandler } from "hono";
import { createRequireRoot } from "./middleware/root";
import {
  destroySession as defaultDestroySession,
  destroyUserSession as defaultDestroyUserSession,
  listUserSessions as defaultListUserSessions,
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "./middleware/session";
import type { PublishedRealtimeEvent } from "./realtime/publishedRealtimeEvents";
import { hasRootAccess } from "./services/root/identities";
import {
  type ApiServiceRuntime,
  getDefaultApiServiceRuntime,
} from "./services/runtime";

export interface RouteAppOverrides {
  readonly destroySession?: (c: Context) => Promise<void>;
  readonly destroyUserSession?: typeof defaultDestroyUserSession;
  readonly listUserSessions?: typeof defaultListUserSessions;
  readonly publish?: (event: PublishedRealtimeEvent) => Promise<void>;
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  /**
   * Gate for the `/root` operator routes. Defaults to a lookup of
   * `users.is_root` through the resolved runtime's database.
   */
  readonly requireRoot?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export type ResolvedRouteAppDeps = Required<RouteAppOverrides>;

// `runtime` is intentionally omitted: resolveRouteAppDeps falls back to the
// lazily-built default, so neither importing this module nor reading these
// overrides constructs the blob object store until the app is assembled.
export const productionRouteAppOverrides: RouteAppOverrides = {
  destroySession: defaultDestroySession,
  destroyUserSession: defaultDestroyUserSession,
  listUserSessions: defaultListUserSessions,
  requireAuth: defaultRequireAuth,
};

export function resolveRouteAppDeps({
  destroySession,
  destroyUserSession,
  listUserSessions,
  publish,
  requireAuth,
  requireRoot,
  runtime,
}: RouteAppOverrides): ResolvedRouteAppDeps {
  const runtimeBase = runtime ?? getDefaultApiServiceRuntime();
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
  const resolvedRequireAuth = requireAuth ?? defaultRequireAuth;

  return {
    destroySession: destroySession ?? defaultDestroySession,
    destroyUserSession: destroyUserSession ?? defaultDestroyUserSession,
    listUserSessions: listUserSessions ?? defaultListUserSessions,
    publish: resolvedPublish,
    requireAuth: resolvedRequireAuth,
    requireRoot:
      requireRoot ??
      createRequireRoot((userId) => hasRootAccess(resolvedRuntime, userId)),
    runtime: resolvedRuntime,
  };
}
