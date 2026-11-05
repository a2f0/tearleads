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
  summary: "Report billing maintenance trouble",
  description:
    "Reports billing maintenance trouble across organizations: failing or overdue Stripe seat syncs, failed or overdue trial expiries, overdue purges, and trials and purges coming due. Only root operators may call it, and each request is recorded in the root audit trail.",
  method: "GET",
  params: z.strictObject({}),
  path: "/root/reports/ops-health",
  responses: { 200: RootOpsHealthReportResponseSchema },
});
