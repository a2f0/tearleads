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
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

// A member-envelopes write commits the wrapped group key for every current
// member, so each user member can now derive the group key and reach every
// container granted to that group. Those containers are not in the member's
// local tree yet — membership (not a direct container grant) made them
// reachable — so, exactly as PR #1184 does for a direct "Share With Peer",
// publish a scopeless, user-scoped `shared_with_you` per user member.
// recipientsForEvent (no container scope) routes it to that user's own sockets,
// whose client re-lists root containers and surfaces the new shares without a
// manual refresh.
//
// This fires from the member-envelopes route, NOT its sibling state route: the
// recipient's re-list fetches the group's policy bundle, and only after the
// envelopes commit does that bundle contain the recipient's own wrap — so the
// surfaced containers are actually decryptable. Publishing from the (earlier)
// state write would re-list against a bundle with no envelope for the member.
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
        const storedEnvelopes = await putPrincipalMemberEnvelopes(runtime, {
          ...c.req.valid("json"),
          principalType: principalParams.principalType,
          principalId: principalParams.principalId,
          // Authorization signal: only a member of this principal may rewrite
          // its member key envelopes (see runPutPrincipalMemberEnvelopesWorkflow).
          requesterUserId: c.get("session").userId,
        });
        // Notify the now-keyed members so a brand-new group share surfaces in
        // their explorer without a manual refresh (see the helper's comment).
        await publishMembershipShareNotifications(publish, storedEnvelopes);
        return c.json<CurrentPrincipalMemberEnvelopesResponse>(storedEnvelopes);
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
