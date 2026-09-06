import { isUuidV4String } from "@tearleads/validators/util";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionEnv, UserSessionSummary } from "../../middleware/session";
import {
  getIdentity,
  getIdentityOrganizations,
  listIdentities,
  MAX_ROOT_IDENTITY_PAGE_SIZE,
  type RootIdentitiesPage,
  RootIdentityError,
  type RootIdentityOrganization,
  type RootIdentitySummary,
} from "../../services/root/identities";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";
import type { RootRouterDeps } from "./shared";

const RootIdentitiesQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  fingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ROOT_IDENTITY_PAGE_SIZE)
    .optional(),
});

const RootIdentityPathParamsSchema = z.strictObject({
  userId: z.string().refine(isUuidV4String),
});

interface RootIdentitySessionResponse {
  readonly createdAt: string;
  readonly id: string;
  readonly ipAddresses: readonly string[];
  readonly lastActiveAt: string;
  readonly lastActiveIp: string | null;
  readonly signingKeyFingerprint: string;
}

interface RootIdentityDetailResponse {
  readonly identity: RootIdentitySummary;
  /** Sessions still live in the session store, most recently active first. */
  readonly sessions: readonly RootIdentitySessionResponse[];
}

interface RootIdentityOrganizationsResponse {
  readonly organizations: readonly RootIdentityOrganization[];
}

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

  route.get(
    "/root/identities",
    requireAuth,
    requireRoot,
    queryParamsValidator(RootIdentitiesQuerySchema, "Invalid query"),
    async (c) => {
      try {
        return c.json<RootIdentitiesPage>(
          await listIdentities(runtime, c.req.valid("query")),
        );
      } catch (error) {
        return respondToStatusError(c, error, RootIdentityError);
      }
    },
  );

  route.get(
    "/root/identities/:userId",
    requireAuth,
    requireRoot,
    pathParamsValidator(RootIdentityPathParamsSchema, "Invalid userId"),
    async (c) => {
      const { userId } = c.req.valid("param");
      try {
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

  route.get(
    "/root/identities/:userId/organizations",
    requireAuth,
    requireRoot,
    pathParamsValidator(RootIdentityPathParamsSchema, "Invalid userId"),
    async (c) => {
      const { userId } = c.req.valid("param");
      try {
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
