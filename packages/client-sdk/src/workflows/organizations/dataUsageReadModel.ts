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

export function loadLocalOrganizationDataUsage(
  input: OrganizationDataUsageProjectionInput,
): Promise<OrganizationDataUsage | null> {
  return loadOrganizationDataUsageProjection(
    input.execSql,
    input.organizationId,
    input.requesterUserId,
  );
}

export async function reconcileOrganizationDataUsage(
  input: ReconcileOrganizationDataUsageInput,
): Promise<OrganizationDataUsage | null> {
  const local = await loadLocalOrganizationDataUsage(input);
  const result = await input.apiClient.getOrganizationDataUsageResult(
    input.organizationId,
    { reportErrors: false },
  );
  if (!result.ok) {
    if (result.status === 403 || result.status === 404) {
      await purgeOrganizationDataUsageProjection(
        input.execSql,
        input.organizationId,
        input.requesterUserId,
      );
      return null;
    }

    result.report();
    return local;
  }

  if (result.data.organizationId !== input.organizationId) {
    input.logError?.(
      `Organization data-usage response scope does not match ${input.organizationId}`,
    );
    return local;
  }

  try {
    await saveOrganizationDataUsageProjection({
      execSql: input.execSql,
      requesterUserId: input.requesterUserId,
      response: result.data,
    });
    return await loadLocalOrganizationDataUsage(input);
  } catch (error) {
    input.logError?.("Failed to persist organization data usage", error);
    return local;
  }
}
