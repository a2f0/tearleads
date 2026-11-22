import { expect } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const projectionPath = `${apiBaseUrl}/containers/:containerId/writer-projection`;

/** A host can retire a caller by switching organization or by signing in again. */
const retirements = {
  "organization change": (scope: { current: boolean }) => {
    scope.current = false;
  },
  "independent sign-in": (_scope: { current: boolean }, client: ApiClient) => {
    client.setAuthToken("identity-b", { boundary: "replacement" });
  },
} as const;

for (const [name, retire] of Object.entries(retirements)) {
  testApiClient(
    `a scoped container projection read stops at a 401 once its callers retired (${name})`,
    async () => {
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      let gets = 0;
      server.use(
        http.get(projectionPath, async () => {
          gets += 1;
          entered.resolve();
          await release.promise;
          return HttpResponse.json(
            {
              code: SESSION_ERROR_CODES.refreshRequired,
              error: "Expired session",
            },
            { status: 401 },
          );
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("identity-a");
      let renewals = 0;
      client.setOnSessionExpired(() => {
        renewals += 1;
        client.setAuthToken("identity-a-renewed");
        return true;
      });
      const scope = { current: true };
      const options = { stillCurrent: () => scope.current };
      const first = client.getContainerWriterProjection("container-1", options);
      const second = client.getContainerWriterProjection(
        "container-1",
        options,
      );
      await entered.promise;
      retire(scope, client);
      release.resolve();
      expect(await first).toBeNull();
      expect(await second).toBeNull();
      expect(renewals).toBe(0);
      expect(gets).toBe(1);
    },
  );
}
