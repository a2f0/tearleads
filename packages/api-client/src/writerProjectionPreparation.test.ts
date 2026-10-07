import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import type { RequestResult } from "./types";

for (const kind of ["container", "document"] as const) {
  const fixture = () =>
    kind === "container"
      ? createContainerWriterProjectionResponse()
      : createDocumentWriterProjectionResponse();
  const path = `${apiBaseUrl}/${kind}s/:id/writer-projection`;
  const read = async (
    client: ApiClient,
  ): Promise<RequestResult<ReturnType<typeof fixture>>> =>
    kind === "container"
      ? client.getContainerWriterProjectionResult("container-1", {
          reportErrors: false,
        })
      : client.getDocumentWriterProjectionResult("document-1", {
          reportErrors: false,
        });
  const plainRead = (client: ApiClient) =>
    kind === "container"
      ? client.getContainerWriterProjection("container-1")
      : client.getDocumentWriterProjection("document-1");
  const pending = {
    code: "principal_history_preparation_pending",
    committed: false,
    progressToken: "a".repeat(64),
  };

  testApiClient(
    `${kind} projection completes explicit preparation before warming its cache`,
    async () => {
      const projection = fixture();
      let calls = 0;
      server.use(
        http.get(path, () => {
          calls += 1;
          return HttpResponse.json(calls === 1 ? pending : projection, {
            status: calls === 1 ? 202 : 200,
          });
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      const result = await read(client);
      expect(result).toEqual({ ok: true, data: projection });
      expect(await plainRead(client)).toEqual(projection);
      expect(calls).toBe(2);
      client.clearWriterProjectionCaches();
      calls = 0;
      expect(await plainRead(client)).toEqual(projection);
      expect(calls).toBe(2);
    },
  );

  testApiClient(
    `${kind} projection refuses malformed preparation without retrying or caching it`,
    async () => {
      let calls = 0;
      server.use(
        http.get(path, () => {
          calls += 1;
          return HttpResponse.json(
            { ...pending, committed: true },
            { status: 202 },
          );
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      expect(await read(client)).toMatchObject({ ok: false, kind: "shape" });
      expect(calls).toBe(1);
      expect(await plainRead(client)).toBeNull();
      expect(calls).toBe(2);
    },
  );

  testApiClient(
    `${kind} projection cancels preparation across an authentication change`,
    async () => {
      let calls = 0;
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("first-user");
      server.use(
        http.get(path, () => {
          calls += 1;
          client.setAuthToken("different-user");
          return HttpResponse.json(pending, { status: 202 });
        }),
      );
      expect(await read(client)).toMatchObject({
        ok: false,
        kind: "cancelled",
      });
      expect(calls).toBe(1);
    },
  );
}
