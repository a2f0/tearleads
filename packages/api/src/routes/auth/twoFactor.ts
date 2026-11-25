import {
  beginTwoFactorSetupOperation,
  disableTwoFactorOperation,
  enableTwoFactorOperation,
  getTwoFactorStatusOperation,
  operationRoutePath,
  regenerateTwoFactorRecoveryCodesOperation,
} from "@tearleads/validators/operation";
import type { TwoFactorErrorResponse } from "@tearleads/validators/response";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  beginTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorStatus,
  regenerateTwoFactorRecoveryCodes,
  type TwoFactorCaller,
  TwoFactorRequestError,
  type TwoFactorSessionStore,
} from "../../services/auth/twoFactor";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";

export interface TwoFactorRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
  readonly sessions: TwoFactorSessionStore;
}

function twoFactorCaller(c: Context<SessionEnv>): TwoFactorCaller {
  const session = c.get("session");
  return {
    fingerprint: session.fingerprint,
    requiredOrganizationIds: session.twoFactorRequiredOrganizationIds,
    sessionId: session.id,
    sessionToken: c.get("sessionToken"),
    sessionVerified: session.twoFactorVerified,
    userId: session.userId,
  };
}

async function answer(
  c: Context<SessionEnv>,
  work: () => Promise<object>,
): Promise<Response> {
  try {
    return c.json(await work());
  } catch (error) {
    if (error instanceof TwoFactorRequestError) {
      return c.json<TwoFactorErrorResponse>(
        { code: error.code, error: error.message },
        error.status,
      );
    }
    throw error;
  }
}

/** The signed-in identity's own authenticator: status, setup, and changes. */
export function createTwoFactorRoute({
  requireAuth,
  runtime,
  sessions,
}: TwoFactorRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    getTwoFactorStatusOperation.method,
    operationRoutePath(getTwoFactorStatusOperation),
    requireAuth,
    (c) => answer(c, () => getTwoFactorStatus(runtime, twoFactorCaller(c))),
  );

  route.on(
    beginTwoFactorSetupOperation.method,
    operationRoutePath(beginTwoFactorSetupOperation),
    requireAuth,
    (c) => answer(c, () => beginTwoFactorSetup(runtime, twoFactorCaller(c))),
  );

  route.on(
    enableTwoFactorOperation.method,
    operationRoutePath(enableTwoFactorOperation),
    requireAuth,
    jsonRequestValidator(enableTwoFactorOperation.body),
    (c) =>
      answer(c, () =>
        enableTwoFactor(
          runtime,
          sessions,
          twoFactorCaller(c),
          c.req.valid("json"),
        ),
      ),
  );

  route.on(
    disableTwoFactorOperation.method,
    operationRoutePath(disableTwoFactorOperation),
    requireAuth,
    jsonRequestValidator(disableTwoFactorOperation.body),
    (c) =>
      answer(c, () =>
        disableTwoFactor(
          runtime,
          sessions,
          twoFactorCaller(c),
          c.req.valid("json"),
        ),
      ),
  );

  route.on(
    regenerateTwoFactorRecoveryCodesOperation.method,
    operationRoutePath(regenerateTwoFactorRecoveryCodesOperation),
    requireAuth,
    jsonRequestValidator(regenerateTwoFactorRecoveryCodesOperation.body),
    (c) =>
      answer(c, () =>
        regenerateTwoFactorRecoveryCodes(
          runtime,
          twoFactorCaller(c),
          c.req.valid("json"),
        ),
      ),
  );

  return route;
}
