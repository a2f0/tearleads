import { expect, spyOn } from "bun:test";
import {
  getPrincipalPolicyOperation,
  isGetPrincipalPolicyOperationResponse,
} from "@tearleads/validators/operation";
import { testApiClient } from "../test/helpers/apiClientTestHarness";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";

testApiClient(
  "caller cancellation wins when a late transport also exceeds its deadline",
  async () => {
    const runtime = new ApiRequestRuntime("http://localhost:3000");
    const controller = new AbortController();
    const reportFailure = runtime.responseRequest.reportFailure;
    const request = spyOn(runtime, "responseRequest").mockImplementation(
      Object.assign(
        async () => {
          controller.abort();
          await Bun.sleep(250);
          return { ok: true as const, data: Response.json({}) };
        },
        { reportFailure },
      ),
    );
    Object.assign(request, { reportFailure });
    try {
      const result = await principalHistoryRequest(runtime, {
        method: "GET",
        path: "/principal",
        requestTimeoutMs: 100,
        operation: getPrincipalPolicyOperation,
        validator: isGetPrincipalPolicyOperationResponse,
        options: { signal: controller.signal, reportErrors: false },
      });
      expect(result).toMatchObject({
        ok: false,
        kind: "cancelled",
        code: "principal_history_context_changed",
      });
    } finally {
      request.mockRestore();
    }
  },
);
