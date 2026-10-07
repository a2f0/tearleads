import {
  getOrganizationPolicyHistoryOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getOrganizationPolicyHistory } from "../../services/organizations/policyHistory";
import { PrincipalPolicyError } from "../../services/principals/shared";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { toPrincipalHistoryPreparationResponse } from "../principals/preparationResponse";
import {
  type OrganizationsRouterDeps,
  toOrganizationPresentationErrorResponse,
} from "./shared";

export function createOrganizationPolicyHistoryRoute({
  requireAuth,
  runtime,
}: OrganizationsRouterDeps) {
  const route = new Hono<SessionEnv>();
  const operation = getOrganizationPolicyHistoryOperation;
  route.on(
    operation.method,
    operationRoutePath(operation),
    requireAuth,
    pathParamsValidator(operation.params, "Invalid organizationId"),
    queryParamsValidator(operation.query),
    async (c) => {
      try {
        c.header("Cache-Control", "private, no-store");
        return c.json(
          await getOrganizationPolicyHistory(runtime, {
            organizationId: c.req.valid("param").organizationId,
            ...c.req.valid("query"),
            requesterUserId: c.get("session").userId,
          }),
        );
      } catch (error) {
        const preparation = toPrincipalHistoryPreparationResponse(error);
        if (preparation) return preparation;
        if (error instanceof PrincipalPolicyError)
          return c.json({ error: error.message }, error.status);
        const response = toOrganizationPresentationErrorResponse(error);
        if (response) return response;
        throw error;
      }
    },
  );
  return route;
}
