import { z } from "zod";
import {
  ErrorResponseSchema,
  RootOpsHealthReportResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { defineJsonOperation } from "./definition";

export const getRootOpsHealthReportOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 403, 500],
  id: "root.reports.opsHealth.get",
  method: "GET",
  params: z.strictObject({}),
  path: "/root/reports/ops-health",
  responses: { 200: RootOpsHealthReportResponseSchema },
});
