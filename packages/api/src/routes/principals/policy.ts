import {
  getPrincipalPolicyOperation,
  operationRoutePath,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getCurrentPrincipalPolicy } from "../../services/principals/getCurrentPrincipalPolicy";
import { putPrincipalPolicy } from "../../services/principals/putPrincipalPolicy";
import { PrincipalPolicyError } from "../../services/principals/shared";
import type { ApiServiceRuntime } from "../../services/runtime";
import { publishBestEffort } from "../../utils/publishBestEffort";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";

interface PrincipalPolicyRouteDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

// A policy write can make a user newly reachable from a principal that already
// has container grants. Those containers are not in the user's local tree yet,
// so, exactly as a direct "Share With Peer" does, publish a scopeless,
// user-scoped `shared_with_you` for each user who actually gained reachability.
// recipientsForEvent (no container scope) routes it to that user's own sockets,
// whose client re-lists root containers and surfaces the new shares without a
// manual refresh.
//
// The workflow derives this list inside the combined policy transaction and
// returns it only after commit. Ungranted policy changes and existing members
// therefore do not wake root-container sync, while nested-group access gains
// still do because grants on current ancestor principals are included.
//
// Best-effort: the envelopes are already persisted, so a publish failure must
// never turn a committed write into a 500.
async function publishMembershipShareNotifications(
  publish: PrincipalPolicyRouteDeps["publish"],
  userIds: readonly string[],
): Promise<void> {
  // Publish concurrently: the per-member notifications are independent, so
  // awaiting them in series would add each socket's publish latency to the
  // response time of a large group's update.
  await Promise.all(
    userIds.map((userId) =>
      publishBestEffort(
        publish,
        { type: "shared_with_you", userId },
        "membership shared_with_you notification",
      ),
    ),
  );
}

function toPrincipalPolicyErrorResponse(error: unknown): Response | null {
  if (error instanceof PrincipalPolicyError) {
    const body = {
      error: error.message,
      ...(error.code === undefined ? {} : { code: error.code }),
    };
    return new Response(JSON.stringify(body), {
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
  const principalPolicyRoute = new Hono<SessionEnv>();

  principalPolicyRoute.on(
    getPrincipalPolicyOperation.method,
    operationRoutePath(getPrincipalPolicyOperation),
    requireAuth,
    pathParamsValidator(
      getPrincipalPolicyOperation.params,
      "Invalid principal route",
    ),
    async (c) => {
      const { principalId, principalType } = c.req.valid("param");

      try {
        return c.json<PrincipalPolicyBundleResponse>(
          await getCurrentPrincipalPolicy(runtime, principalType, principalId),
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

  principalPolicyRoute.on(
    putPrincipalPolicyOperation.method,
    operationRoutePath(putPrincipalPolicyOperation),
    requireAuth,
    jsonRequestValidator(putPrincipalPolicyOperation.body),
    pathParamsValidator(
      putPrincipalPolicyOperation.params,
      "Invalid principal route",
    ),
    async (c) => {
      const { principalId, principalType } = c.req.valid("param");

      try {
        const result = await putPrincipalPolicy(runtime, {
          ...c.req.valid("json"),
          expectedPrincipalType: principalType,
          expectedPrincipalId: principalId,
          requesterUserId: c.get("session").userId,
        });
        await publishMembershipShareNotifications(
          publish,
          result.sharedWithYouUserIds,
        );
        return c.json<PrincipalPolicyBundleResponse>(result.policy);
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
