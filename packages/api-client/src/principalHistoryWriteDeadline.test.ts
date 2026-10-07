import { expect, spyOn } from "bun:test";
import {
  commitOrganizationGroupPolicyOperation,
  isCommitOrganizationGroupPolicyOperationResponse,
  isPutPrincipalPolicyOperationResponse,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";
import { http, passthrough } from "msw";
import { createPrincipalPolicyBundleResponse } from "../test/helpers/apiClientTestFactories";
import {
  server as mockServer,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";

for (const compound of [false, true]) {
  for (const cancel of [false, true]) {
    testApiClient(
      `${compound ? "compound" : "standalone"} write ${cancel ? "keeps caller cancellation uncertain" : "waits for acknowledgement beyond the read deadline"}`,
      async () => {
        mockServer.use(
          http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()),
        );
        const controller = new AbortController();
        const policy = {
          ...createPrincipalPolicyBundleResponse(),
          containerMutations: [],
        };
        const acknowledgement = compound
          ? { groupPolicy: policy, organizationPolicy: policy }
          : policy;
        let commits = 0;
        const timer = spyOn(globalThis, "setTimeout");
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch() {
            commits += 1;
            // Fire the real read timer after commit without sleeping 15 seconds.
            for (const [callback, delay, ...args] of timer.mock.calls) {
              if (delay === 15_000 && typeof callback === "function")
                callback(...args);
            }
            if (cancel) controller.abort();
            return Response.json(acknowledgement);
          },
        });
        try {
          const result = await principalHistoryRequest(
            new ApiRequestRuntime(server.url.origin),
            {
              method: "PUT",
              path: "/principal",
              body: "{}",
              operation: compound
                ? commitOrganizationGroupPolicyOperation
                : putPrincipalPolicyOperation,
              validator: (value): value is typeof acknowledgement =>
                compound
                  ? isCommitOrganizationGroupPolicyOperationResponse(value)
                  : isPutPrincipalPolicyOperationResponse(value),
              options: { signal: controller.signal, reportErrors: false },
            },
          );
          expect(commits).toBe(1);
          if (cancel)
            expect(result).toMatchObject({
              ok: false,
              kind: "outcome-unknown",
            });
          else expect(result).toEqual({ ok: true, data: acknowledgement });
        } finally {
          timer.mockRestore();
          await server.stop(true);
        }
      },
    );
  }
}
