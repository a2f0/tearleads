import type { PendingBlobDeletionsQuery } from "@tearleads/validators/operation";
import type { PendingBlobDeletionsResponse } from "@tearleads/validators/response";
import {
  captureOrganizationPresentationAccessAttempt,
  isOrganizationPresentationAccessAttemptCurrent,
} from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import type { RootRequestOutcome } from "../../workflows/root";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { activeOrganizationDataRuntime } from "./organizationWorkflowRuntime";
import { currentOrganizationMutation } from "./principalMutationScope";

/** Live server-authorized snapshots, never persisted in the usage projection. */
export async function listPendingBlobDeletions(
  service: InternalRuntime,
  organizationId: string,
  query: PendingBlobDeletionsQuery = {},
): Promise<RootRequestOutcome<PendingBlobDeletionsResponse>> {
  const active = activeOrganizationDataRuntime(service, organizationId);
  if (!active) {
    return {
      ok: false,
      status: null,
      message: "An authenticated active organization is required.",
    };
  }
  const { stillCurrent } = currentOrganizationMutation(service);
  const access = {
    execSql: active.runtime.infra.execSql,
    organizationId,
    requesterUserId: active.userId,
  };
  const attempts = (["readModel", "usage"] as const).map((projection) =>
    captureOrganizationPresentationAccessAttempt(access, projection),
  );
  const result =
    await active.runtime.apiClient.listOrganizationPendingBlobDeletionsResult(
      organizationId,
      query,
    );
  if (
    !stillCurrent() ||
    attempts.some(
      (attempt) =>
        !isOrganizationPresentationAccessAttemptCurrent(access, attempt),
    )
  ) {
    return {
      ok: false,
      status: null,
      message:
        "The session or organization access changed while the request was in flight.",
    };
  }
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, status: result.status, message: result.message };
}
