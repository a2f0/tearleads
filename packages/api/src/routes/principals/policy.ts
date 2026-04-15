import {
  isPutPrincipalMemberEnvelopesRequest,
  isPutPrincipalStateRequest,
} from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { isUuidV4String } from "@tearleads/validators/util";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { getCurrentPrincipalPolicy } from "../../services/principals/getCurrentPrincipalPolicy";
import { putPrincipalMemberEnvelopes } from "../../services/principals/putPrincipalMemberEnvelopes";
import { putPrincipalState } from "../../services/principals/putPrincipalState";
import {
  PrincipalPolicyError,
  parseManagedPrincipalType,
} from "../../services/principals/shared";
import type { ApiServiceRuntime } from "../../services/runtime";

interface PrincipalPolicyRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

function getPrincipalRouteParams(input: {
  principalId: string;
  principalType: string;
}): { principalId: string; principalType: "group" | "organization" } | null {
  const principalType = parseManagedPrincipalType(input.principalType);

  if (!principalType || !isUuidV4String(input.principalId)) {
    return null;
  }

  return {
    principalType,
    principalId: input.principalId,
  };
}

function toPrincipalPolicyErrorResponse(error: unknown): Response | null {
  if (error instanceof PrincipalPolicyError) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: error.status,
    });
  }

  return null;
}

export function createPrincipalPolicyRoute({
  requireAuth,
  runtime,
}: PrincipalPolicyRouteDeps) {
  const principalPolicyRoute = new Hono();

  principalPolicyRoute.get(
    "/principals/:principalType/:principalId/policy",
    requireAuth,
    async (c) => {
      const principalParams = getPrincipalRouteParams({
        principalType: c.req.param("principalType"),
        principalId: c.req.param("principalId"),
      });

      if (!principalParams) {
        return c.json({ error: "Invalid principal route" }, 400);
      }

      try {
        return c.json<PrincipalPolicyBundleResponse>(
          await getCurrentPrincipalPolicy(
            runtime,
            principalParams.principalType,
            principalParams.principalId,
          ),
        );
      } catch (error) {
        const response = toPrincipalPolicyErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );

  principalPolicyRoute.put(
    "/principals/:principalType/:principalId/state",
    requireAuth,
    validator("json", (value, c) => {
      if (!isPutPrincipalStateRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const principalParams = getPrincipalRouteParams({
        principalType: c.req.param("principalType"),
        principalId: c.req.param("principalId"),
      });

      if (!principalParams) {
        return c.json({ error: "Invalid principal route" }, 400);
      }

      try {
        return c.json<PrincipalStateResponse>(
          await putPrincipalState(runtime, {
            ...c.req.valid("json"),
            expectedPrincipalType: principalParams.principalType,
            expectedPrincipalId: principalParams.principalId,
          }),
        );
      } catch (error) {
        const response = toPrincipalPolicyErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );

  principalPolicyRoute.put(
    "/principals/:principalType/:principalId/member-envelopes",
    requireAuth,
    validator("json", (value, c) => {
      if (!isPutPrincipalMemberEnvelopesRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const principalParams = getPrincipalRouteParams({
        principalType: c.req.param("principalType"),
        principalId: c.req.param("principalId"),
      });

      if (!principalParams) {
        return c.json({ error: "Invalid principal route" }, 400);
      }

      try {
        return c.json<CurrentPrincipalMemberEnvelopesResponse>(
          await putPrincipalMemberEnvelopes(runtime, {
            ...c.req.valid("json"),
            principalType: principalParams.principalType,
            principalId: principalParams.principalId,
          }),
        );
      } catch (error) {
        const response = toPrincipalPolicyErrorResponse(error);
        if (response) {
          return response;
        }

        throw error;
      }
    },
  );

  return principalPolicyRoute;
}
