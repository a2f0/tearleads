import { expect } from "bun:test";
import {
  encodeDocumentWriterProjection,
  SESSION_ERROR_CODES,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { createDocumentWriterProjectionResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestMetrics } from "./apiRequestMetrics";
import type { ApiNetworkError } from "./networkFailure";

const projectionPath = `${apiBaseUrl}/documents/:documentId/writer-projection`;
const expired = () =>
  HttpResponse.json(
    { code: SESSION_ERROR_CODES.refreshRequired, error: "Expired session" },
    { status: 401 },
  );

/** A host can retire a caller by switching organization or by signing in again. */
const retirements = {
  "organization change": (scope: { current: boolean }) => {
    scope.current = false;
  },
  "independent sign-in": (_scope: { current: boolean }, client: ApiClient) => {
    client.setAuthToken("identity-b", { boundary: "replacement" });
  },
} as const;

function renewingClient() {
  const client = new ApiClient(apiBaseUrl);
  client.setAuthToken("identity-a");
  const renewals = { count: 0 };
  client.setOnSessionExpired(() => {
    renewals.count += 1;
    client.setAuthToken("identity-a-renewed");
    return true;
  });
  return { client, renewals };
}

testApiClient(
  "scoped writer-projection reads share one fetch and its cached result",
  async () => {
    const projection = createDocumentWriterProjectionResponse();
    const release = createDeferred<void>();
    let gets = 0;
    server.use(
      http.get(projectionPath, async () => {
        gets += 1;
        await release.promise;
        return HttpResponse.json(encodeDocumentWriterProjection(projection));
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("identity-a");
    const scoped = { stillCurrent: () => true, reportErrors: false };
    const first = client.getDocumentWriterProjectionResult(
      projection.documentId,
      scoped,
    );
    const second = client.getDocumentWriterProjectionResult(
      projection.documentId,
      scoped,
    );
    release.resolve();
    expect(await first).toEqual({ ok: true, data: projection });
    expect(await second).toEqual({ ok: true, data: projection });
    expect(
      await client.getDocumentWriterProjectionResult(
        projection.documentId,
        scoped,
      ),
    ).toEqual({ ok: true, data: projection });
    expect(gets).toBe(1);
  },
);

for (const [name, retire] of Object.entries(retirements)) {
  testApiClient(
    `a shared writer-projection read stops at a 401 once every caller retired (${name})`,
    async () => {
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      let gets = 0;
      server.use(
        http.get(projectionPath, async () => {
          gets += 1;
          entered.resolve();
          await release.promise;
          return expired();
        }),
      );
      const { client, renewals } = renewingClient();
      const scope = { current: true };
      const options = {
        reportErrors: false,
        stillCurrent: () => scope.current,
      };
      const first = client.getDocumentWriterProjectionResult(
        "document-1",
        options,
      );
      const second = client.getDocumentWriterProjectionResult(
        "document-1",
        options,
      );
      await entered.promise;
      retire(scope, client);
      release.resolve();
      expect(await first).toMatchObject({ ok: false, kind: "cancelled" });
      expect(await second).toMatchObject({ ok: false, kind: "cancelled" });
      expect(renewals.count).toBe(0);
      expect(gets).toBe(1);
    },
  );
}

testApiClient(
  "an unscoped caller keeps a shared writer-projection read alive",
  async () => {
    const projection = createDocumentWriterProjectionResponse();
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    let gets = 0;
    server.use(
      http.get(projectionPath, async () => {
        gets += 1;
        if (gets === 1) {
          entered.resolve();
          await release.promise;
          return expired();
        }
        return HttpResponse.json(encodeDocumentWriterProjection(projection));
      }),
    );
    const { client, renewals } = renewingClient();
    const scope = { current: true };
    const scoped = client.getDocumentWriterProjectionResult(
      projection.documentId,
      { reportErrors: false, stillCurrent: () => scope.current },
    );
    const unscoped = client.getDocumentWriterProjectionResult(
      projection.documentId,
      { reportErrors: false },
    );
    await entered.promise;
    scope.current = false;
    release.resolve();
    expect(await scoped).toMatchObject({ ok: false, kind: "cancelled" });
    expect(await unscoped).toEqual({ ok: true, data: projection });
    expect(renewals.count).toBe(1);
    expect(gets).toBe(2);
  },
);

testApiClient(
  "a current caller never joins a read whose callers all retired",
  async () => {
    const projection = createDocumentWriterProjectionResponse();
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    let gets = 0;
    server.use(
      http.get(projectionPath, async () => {
        gets += 1;
        if (gets === 1) {
          entered.resolve();
          await release.promise;
          return expired();
        }
        return HttpResponse.json(encodeDocumentWriterProjection(projection));
      }),
    );
    const { client, renewals } = renewingClient();
    const retired = { current: true };
    const first = client.getDocumentWriterProjectionResult(
      projection.documentId,
      { reportErrors: false, stillCurrent: () => retired.current },
    );
    await entered.promise;
    retired.current = false;
    const second = client.getDocumentWriterProjectionResult(
      projection.documentId,
      { reportErrors: false, stillCurrent: () => true },
    );
    release.resolve();
    expect(await first).toMatchObject({ ok: false, kind: "cancelled" });
    expect(await second).toEqual({ ok: true, data: projection });
    expect(renewals.count).toBe(0);
    expect(gets).toBe(2);
  },
);

testApiClient(
  "a reachability probe that outlives its request publishes no diagnostics",
  async () => {
    server.use(
      http.delete(`${apiBaseUrl}/containers/target`, () =>
        HttpResponse.error(),
      ),
    );
    const probeStarted = createDeferred<void>();
    const probeRelease = createDeferred<void>();
    const client = new ApiClient(apiBaseUrl, {
      getIdentity: () => null,
      metrics: new ApiRequestMetrics(),
      networkFailureProbe: async () => {
        probeStarted.resolve();
        await probeRelease.promise;
        return "reachable";
      },
    });
    client.setAuthToken("identity-a");
    const failures: ApiNetworkError[] = [];
    const errors: string[] = [];
    client.setOnError((message) => errors.push(message));
    client.setOnNetworkFailure((failure) => failures.push(failure));
    const scope = { current: true };
    const pending = client.deleteContainerResult("target", {
      stillCurrent: () => scope.current,
    });
    await probeStarted.promise;
    scope.current = false;
    probeRelease.resolve();
    expect(await pending).toMatchObject({ ok: false, kind: "cancelled" });
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
  },
);
