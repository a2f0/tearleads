import { isPutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { isUuidV4String } from "@tearleads/validators/util";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { getCurrentPrincipalPolicy } from "../../services/principals/getCurrentPrincipalPolicy";
import { putPrincipalPolicy } from "../../services/principals/putPrincipalPolicy";
import {
  PrincipalPolicyError,
  parseManagedPrincipalType,
} from "../../services/principals/shared";
import type { ApiServiceRuntime } from "../../services/runtime";

interface PrincipalPolicyRouteDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

// A policy write atomically commits signed state and the wrapped group key for
// every current member. Each user member can then derive the group key and
// reach every container granted to that group. Those containers are not in
// the member's local tree yet — membership (not a direct container grant) made
// them reachable — so, exactly as PR #1184 does for a direct "Share With Peer",
// publish a scopeless, user-scoped `shared_with_you` per user member.
// recipientsForEvent (no container scope) routes it to that user's own sockets,
// whose client re-lists root containers and surfaces the new shares without a
// manual refresh.
//
// This fires only after the combined policy transaction returns, so the
// recipient's re-list can never observe a committed state without its wrap.
//
// Best-effort: the envelopes are already persisted, so a publish failure must
// never turn a committed write into a 500. We over-notify all current user
// members rather than diffing the previous set; the client single-flights and
// coalesces the root re-list, so redundant nudges are harmless. Recipients are
// read from the persisted response (the stored member set), not the raw request
// body. Group-type members carry a groupId, not a userId, so they are skipped.
async function publishMembershipShareNotifications(
  publish: PrincipalPolicyRouteDeps["publish"],
  storedEnvelopes: CurrentPrincipalMemberEnvelopesResponse,
): Promise<void> {
  // Publish concurrently: the per-member notifications are independent, so
  // awaiting them in series would add each socket's publish latency to the
  // response time of a large group's update.
  await Promise.all(
    storedEnvelopes.envelopes
      .filter((envelope) => envelope.memberPrincipalType === "user")
      .map(async (envelope) => {
        try {
          await publish({
            type: "shared_with_you",
            userId: envelope.memberPrincipalId,
          });
        } catch (error) {
          console.error(
            "Failed to publish membership shared_with_you notification:",
            error,
          );
        }
      }),
  );
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
  publish,
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
    "/principals/:principalType/:principalId/policy",
    requireAuth,
    validator("json", (value, c) => {
      if (!isPutPrincipalPolicyRequest(value)) {
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
        const storedPolicy = await putPrincipalPolicy(runtime, {
          ...c.req.valid("json"),
          expectedPrincipalType: principalParams.principalType,
          expectedPrincipalId: principalParams.principalId,
          requesterUserId: c.get("session").userId,
        });
        await publishMembershipShareNotifications(
          publish,
          storedPolicy.currentMemberEnvelopes,
        );
        return c.json<PrincipalPolicyBundleResponse>(storedPolicy);
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
