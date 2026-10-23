import {
  getRootIdentityOperation,
  listRootIdentitiesOperation,
  listRootIdentityOrganizationsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type {
  RootIdentitiesResponse,
  RootIdentityDetailResponse,
  RootIdentityOrganizationsResponse,
  RootIdentitySessionResponse,
} from "@tearleads/validators/response";
import { SHA256_HEX_LENGTH } from "@tearleads/validators/util";
import { Hono } from "hono";
import type { SessionEnv, UserSessionSummary } from "../../middleware/session";
import {
  getIdentity,
  getIdentityOrganizations,
  listIdentities,
  RootIdentityError,
  resolveIdentityIdByFingerprint,
} from "../../services/root/identities";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";
import { auditRootRequest, type RootRouterDeps } from "./shared";

function toSessionResponse(
  session: UserSessionSummary,
): RootIdentitySessionResponse {
  return {
    createdAt: new Date(session.createdAt).toISOString(),
    id: session.id,
    ipAddresses: session.ipAddresses,
    lastActiveAt: new Date(session.lastActiveAt).toISOString(),
    lastActiveIp: session.lastActiveIp,
    signingKeyFingerprint: session.fingerprint,
  };
}

export function createRootIdentitiesRoute({
  listUserSessions,
  requireAuth,
  requireRoot,
  runtime,
}: RootRouterDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    listRootIdentitiesOperation.method,
    operationRoutePath(listRootIdentitiesOperation),
    requireAuth,
    requireRoot,
    queryParamsValidator(listRootIdentitiesOperation.query, "Invalid query"),
    async (c) => {
      try {
        const { cursor, fingerprint, limit, rootOnly, userId } =
          c.req.valid("query");
        const onlyRoot = rootOnly === true || rootOnly === "true";
        // A listing narrowed to one exact user ID or full fingerprint is a
        // lookup of that identity, so it also lands in that identity's audit
        // trail. Resolving the fingerprint reads only the user ID.
        const fingerprintUserId =
          fingerprint?.length === SHA256_HEX_LENGTH
            ? await resolveIdentityIdByFingerprint(runtime, fingerprint)
            : null;
        await auditRootRequest(c, runtime, {
          action: listRootIdentitiesOperation.id,
          filters: {
            fingerprint,
            rootOnly: onlyRoot ? "true" : undefined,
            userId,
          },
          targetUserId: userId ?? fingerprintUserId ?? undefined,
        });
        return c.json<RootIdentitiesResponse>(
          await listIdentities(runtime, {
            cursor,
            fingerprintPrefix: fingerprint,
            limit: limit === undefined ? undefined : Number(limit),
            rootOnly: onlyRoot,
            userId,
          }),
        );
      } catch (error) {
        return respondToStatusError(c, error, RootIdentityError);
      }
    },
  );

  route.on(
    getRootIdentityOperation.method,
    operationRoutePath(getRootIdentityOperation),
    requireAuth,
    requireRoot,
    pathParamsValidator(getRootIdentityOperation.params, "Invalid userId"),
    async (c) => {
      const { userId } = c.req.valid("param");
      try {
        await auditRootRequest(c, runtime, {
          action: getRootIdentityOperation.id,
          targetUserId: userId,
        });
        const identity = await getIdentity(runtime, userId);
        // No token belongs to the operator here, so no session is "current".
        const sessions = await listUserSessions({ currentToken: "", userId });
        return c.json<RootIdentityDetailResponse>({
          identity,
          sessions: sessions.map(toSessionResponse),
        });
      } catch (error) {
        return respondToStatusError(c, error, RootIdentityError);
      }
    },
  );

  route.on(
    listRootIdentityOrganizationsOperation.method,
    operationRoutePath(listRootIdentityOrganizationsOperation),
    requireAuth,
    requireRoot,
    pathParamsValidator(
      listRootIdentityOrganizationsOperation.params,
      "Invalid userId",
    ),
    async (c) => {
      const { userId } = c.req.valid("param");
      try {
        await auditRootRequest(c, runtime, {
          action: listRootIdentityOrganizationsOperation.id,
          targetUserId: userId,
        });
        return c.json<RootIdentityOrganizationsResponse>({
          organizations: await getIdentityOrganizations(runtime, userId),
        });
      } catch (error) {
        return respondToStatusError(c, error, RootIdentityError);
      }
    },
  );

  return route;
}
