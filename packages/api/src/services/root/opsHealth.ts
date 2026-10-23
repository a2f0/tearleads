import type { RootOpsHealthReportResponse } from "@tearleads/validators/response";
import { loadRootOpsHealthReport } from "../../workflows/root/opsHealth";
import type { ApiServiceRuntime } from "../runtime";

export async function getOpsHealthReport(
  runtime: ApiServiceRuntime,
  now: Date = new Date(),
): Promise<RootOpsHealthReportResponse> {
  return loadRootOpsHealthReport(runtime.db, now);
}
