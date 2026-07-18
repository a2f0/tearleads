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
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  captureOrganizationDataUsageAccessAttempt,
  denyOrganizationDataUsageAccess,
  isOrganizationDataUsageAccessAttemptCurrent,
  isOrganizationDataUsageAccessReadable,
  restoreOrganizationDataUsageAccess,
  runOrganizationDataUsageAccessMutation,
} from "./dataUsageAccessState";

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
  const attempt = captureOrganizationDataUsageAccessAttempt(input);
  if (!isOrganizationDataUsageAccessReadable(input)) {
    return null;
  }
  const projection = await loadOrganizationDataUsageProjection(
    input.execSql,
    input.organizationId,
    input.requesterUserId,
  );
  return isOrganizationDataUsageAccessAttemptCurrent(input, attempt) &&
    isOrganizationDataUsageAccessReadable(input)
    ? projection
    : null;
}

export async function reconcileOrganizationDataUsage(
  input: ReconcileOrganizationDataUsageInput,
): Promise<OrganizationDataUsage | null> {
  const attempt = captureOrganizationDataUsageAccessAttempt(input);
  const local = await loadLocalOrganizationDataUsage(input);
  const result = await input.apiClient.getOrganizationDataUsageResult(
    input.organizationId,
    { reportErrors: false },
  );
  if (!result.ok) {
    if (result.status === 403 || result.status === 404) {
      denyOrganizationDataUsageAccess(input);
      try {
        await runOrganizationDataUsageAccessMutation(input.execSql, () =>
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
    return isOrganizationDataUsageAccessAttemptCurrent(input, attempt) &&
      isOrganizationDataUsageAccessReadable(input)
      ? local
      : null;
  }

  if (result.data.organizationId !== input.organizationId) {
    input.logError?.(
      `Organization data-usage response scope does not match ${input.organizationId}`,
    );
    return isOrganizationDataUsageAccessAttemptCurrent(input, attempt) &&
      isOrganizationDataUsageAccessReadable(input)
      ? local
      : null;
  }

  return runOrganizationDataUsageAccessMutation(input.execSql, async () => {
    if (!isOrganizationDataUsageAccessAttemptCurrent(input, attempt)) {
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
      return isOrganizationDataUsageAccessAttemptCurrent(input, attempt) &&
        isOrganizationDataUsageAccessReadable(input)
        ? local
        : null;
    }
    return restoreOrganizationDataUsageAccess(input, attempt)
      ? result.data
      : null;
  });
}
