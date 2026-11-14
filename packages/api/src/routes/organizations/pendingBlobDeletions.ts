import {
  listOrganizationPendingBlobDeletionsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  listOrganizationPendingBlobDeletions,
  PendingBlobDeletionsError,
} from "../../services/blobs/pendingDeletions";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";
import {
  type OrganizationsRouterDeps,
  toOrganizationPresentationErrorResponse,
} from "./shared";

export function createOrganizationPendingBlobDeletionsRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();
  route.on(
    listOrganizationPendingBlobDeletionsOperation.method,
    operationRoutePath(listOrganizationPendingBlobDeletionsOperation),
    requireAuth,
    pathParamsValidator(
      listOrganizationPendingBlobDeletionsOperation.params,
      "Invalid organizationId",
    ),
    queryParamsValidator(
      listOrganizationPendingBlobDeletionsOperation.query,
      "Invalid query",
    ),
    async (c) => {
      try {
        return c.json(
          await listOrganizationPendingBlobDeletions(
            runtime,
            c.req.valid("param").organizationId,
            c.get("session").userId,
            c.req.valid("query"),
          ),
        );
      } catch (error) {
        const response = toOrganizationPresentationErrorResponse(error);
        if (response) return response;
        return respondToStatusError(c, error, PendingBlobDeletionsError);
      }
    },
  );
  return route;
}
