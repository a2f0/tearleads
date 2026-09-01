import type {
  RequestResult,
  RequestResultOptions,
} from "@tearleads/api-client";
import type { OrganizationDataUsageResponse } from "@tearleads/validators/response";
import {
  loadOrganizationDataUsageProjection,
  purgeOrganizationDataUsageProjection,
  saveOrganizationDataUsageProjection,
} from "../../data/persistence/organizations/organizationDataUsagePersistence";
import { recordOrganizationPresentationDenials } from "../../data/persistence/organizations/organizationPresentationDenialPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  captureOrganizationPresentationAccessAttempt,
  denyOrganizationPresentationAccess,
  isOrganizationPresentationAccessAttemptCurrent,
  isOrganizationPresentationAccessReadable,
  type OrganizationPresentationAccessAttempt,
  restoreOrganizationPresentationAccess,
  runOrganizationPresentationMutation,
  runOrganizationPresentationRead,
} from "./organizationPresentationAccessState";

export type OrganizationDataUsage = OrganizationDataUsageResponse;

interface OrganizationDataUsageApi {
  getOrganizationDataUsageResult(
    organizationId: string,
    options?: RequestResultOptions,
  ): Promise<RequestResult<OrganizationDataUsageResponse>>;
}

interface OrganizationDataUsageProjectionInput {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}

export interface ReconcileOrganizationDataUsageInput
  extends OrganizationDataUsageProjectionInput {
  readonly apiClient: OrganizationDataUsageApi;
  readonly logError?:
    | ((message: string | Error, cause?: unknown) => void)
    | undefined;
}

export async function loadLocalOrganizationDataUsage(
  input: OrganizationDataUsageProjectionInput,
): Promise<OrganizationDataUsage | null> {
  return runOrganizationPresentationRead(input, "usage", () =>
    loadOrganizationDataUsageProjection(
      input.execSql,
      input.organizationId,
      input.requesterUserId,
    ),
  );
}

function retainedIfUsageReadable<T>(
  input: OrganizationDataUsageProjectionInput,
  attempt: OrganizationPresentationAccessAttempt,
  value: T,
): T | null {
  return isOrganizationPresentationAccessAttemptCurrent(input, attempt) &&
    isOrganizationPresentationAccessReadable(input, "usage")
    ? value
    : null;
}

export async function reconcileOrganizationDataUsage(
  input: ReconcileOrganizationDataUsageInput,
): Promise<OrganizationDataUsage | null> {
  const attempt = captureOrganizationPresentationAccessAttempt(input, "usage");
  const local = await loadLocalOrganizationDataUsage(input);
  const result = await input.apiClient.getOrganizationDataUsageResult(
    input.organizationId,
    { reportErrors: false },
  );
  if (!result.ok) {
    if (result.status === 403 || result.status === 404) {
      denyOrganizationPresentationAccess(input, ["usage"]);
      // Durable marker first: a failed purge plus a restart must not serve
      // the revoked usage projection.
      try {
        await runOrganizationPresentationMutation(input.execSql, () =>
          recordOrganizationPresentationDenials(input, ["usage"]),
        );
      } catch (error) {
        input.logError?.(
          "Failed to record denied organization data usage",
          error,
        );
      }
      try {
        await runOrganizationPresentationMutation(input.execSql, () =>
          purgeOrganizationDataUsageProjection(
            input.execSql,
            input.organizationId,
            input.requesterUserId,
          ),
        );
      } catch (error) {
        input.logError?.(
          "Failed to purge denied organization data usage",
          error,
        );
      }
      return null;
    }

    result.report();
    return retainedIfUsageReadable(input, attempt, local);
  }

  if (result.data.organizationId !== input.organizationId) {
    input.logError?.(
      `Organization data-usage response scope does not match ${input.organizationId}`,
    );
    return retainedIfUsageReadable(input, attempt, local);
  }

  return runOrganizationPresentationMutation(input.execSql, async () => {
    if (!isOrganizationPresentationAccessAttemptCurrent(input, attempt)) {
      return null;
    }
    try {
      await saveOrganizationDataUsageProjection({
        execSql: input.execSql,
        requesterUserId: input.requesterUserId,
        response: result.data,
      });
    } catch (error) {
      input.logError?.("Failed to persist organization data usage", error);
      return retainedIfUsageReadable(input, attempt, local);
    }
    return restoreOrganizationPresentationAccess(input, attempt)
      ? result.data
      : null;
  });
}
