import type { PendingBlobDeletionsQuery } from "@tearleads/validators/operation";
import type { PendingBlobDeletionsResponse } from "@tearleads/validators/response";
import {
  captureOrganizationPresentationAccessAttempt,
  isOrganizationPresentationAccessAttemptCurrent,
} from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { activeOrganizationDataRuntime } from "./organizationWorkflowRuntime";
import { currentOrganizationMutation } from "./principalMutationScope";

export type PendingBlobDeletionsOutcome =
  | { readonly ok: true; readonly data: PendingBlobDeletionsResponse }
  | {
      readonly ok: false;
      readonly status: number | null;
      readonly message: string;
    };

/** Live server-authorized snapshots, never persisted in the usage projection. */
export async function listOrganizationPendingBlobDeletions(
  service: InternalRuntime,
  organizationId: string,
  query: PendingBlobDeletionsQuery = {},
): Promise<PendingBlobDeletionsOutcome> {
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
