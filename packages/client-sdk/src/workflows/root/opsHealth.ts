import type { RequestResult } from "@tearleads/api-client";
import type { RootOpsHealthReportResponse } from "@tearleads/validators/response";
import { type RootRequestOutcome, toOutcome } from "./identities";

/** Cross-organization billing maintenance health (wire shape). */
export type RootOpsHealthReport = RootOpsHealthReportResponse;

export interface RootOpsHealthApi {
  getRootOpsHealthReportResult(): Promise<
    RequestResult<RootOpsHealthReportResponse>
  >;
}

export async function loadRootOpsHealthReport(
  api: RootOpsHealthApi,
): Promise<RootRequestOutcome<RootOpsHealthReport>> {
  return toOutcome(await api.getRootOpsHealthReportResult());
}
