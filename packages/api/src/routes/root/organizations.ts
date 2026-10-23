import {
  getRootOrganizationOperation,
  listRootOrganizationIdentitiesOperation,
  listRootOrganizationsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  getOrganization,
  getOrganizationIdentities,
  listOrganizations,
  RootOrganizationError,
} from "../../services/root/organizations";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";
import {
  auditRootRequest,
  organizationSearchAudit,
  type RootRouterDeps,
} from "./shared";

export function createRootOrganizationsRoute({
  requireAuth,
  requireRoot,
  runtime,
}: RootRouterDeps) {
  const route = new Hono<SessionEnv>();
  route.on(
    listRootOrganizationsOperation.method,
    operationRoutePath(listRootOrganizationsOperation),
    requireAuth,
    requireRoot,
    queryParamsValidator(listRootOrganizationsOperation.query, "Invalid query"),
    async (c) => {
      try {
        const query = c.req.valid("query");
        await auditRootRequest(c, runtime, {
          action: listRootOrganizationsOperation.id,
          ...organizationSearchAudit(query.search),
        });
        return c.json(await listOrganizations(runtime, query));
      } catch (error) {
        return respondToStatusError(c, error, RootOrganizationError);
      }
    },
  );
  route.on(
    getRootOrganizationOperation.method,
    operationRoutePath(getRootOrganizationOperation),
    requireAuth,
    requireRoot,
    pathParamsValidator(
      getRootOrganizationOperation.params,
      "Invalid organizationId",
    ),
    async (c) => {
      try {
        const { organizationId } = c.req.valid("param");
        await auditRootRequest(c, runtime, {
          action: getRootOrganizationOperation.id,
          targetOrganizationId: organizationId,
        });
        return c.json(await getOrganization(runtime, organizationId));
      } catch (error) {
        return respondToStatusError(c, error, RootOrganizationError);
      }
    },
  );
  route.on(
    listRootOrganizationIdentitiesOperation.method,
    operationRoutePath(listRootOrganizationIdentitiesOperation),
    requireAuth,
    requireRoot,
    pathParamsValidator(
      listRootOrganizationIdentitiesOperation.params,
      "Invalid organizationId",
    ),
    queryParamsValidator(
      listRootOrganizationIdentitiesOperation.query,
      "Invalid query",
    ),
    async (c) => {
      try {
        const { organizationId } = c.req.valid("param");
        await auditRootRequest(c, runtime, {
          action: listRootOrganizationIdentitiesOperation.id,
          targetOrganizationId: organizationId,
        });
        return c.json(
          await getOrganizationIdentities(
            runtime,
            organizationId,
            c.req.valid("query"),
          ),
        );
      } catch (error) {
        return respondToStatusError(c, error, RootOrganizationError);
      }
    },
  );
  return route;
}
