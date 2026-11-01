import { expect } from "bun:test";
import { getHealthOperation } from "@tearleads/validators/operation";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import type { ApiNetworkError } from "./networkFailure";

testApiClient(
  "hands a thrown fetch's classified failure to the observer",
  async () => {
    server.use(http.get(`${apiBaseUrl}/`, () => HttpResponse.error()));
    const client = new ApiClient(apiBaseUrl);
    const failures: ApiNetworkError[] = [];
    const errors: string[] = [];
    client.setOnError((message) => errors.push(message));
    client.setOnNetworkFailure((error) => failures.push(error));

    expect(await client.getHealth()).toBeNull();

    expect(failures).toHaveLength(1);
    expect(failures[0]?.details).toMatchObject({
      classification: "unclassified",
      method: "GET",
      pathTemplate: "/",
      attempt: 1,
    });
    expect(errors).toHaveLength(1);
  },
);

testApiClient(
  "an observer that throws leaves the request's failure unchanged",
  async () => {
    server.use(http.get(`${apiBaseUrl}/`, () => HttpResponse.error()));
    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setOnError((message) => errors.push(message));
    client.setOnNetworkFailure(() => {
      throw new Error("diagnostics failed");
    });

    expect(await client.getHealth()).toBeNull();
    expect(errors).toHaveLength(1);
    expect(
      client.getRequestFailure({ method: "GET", path: "/" }),
    ).toMatchObject({ kind: "network" });
  },
);

testApiClient("plain cancellations never reach the observer", async () => {
  const controller = new AbortController();
  server.use(
    http.get(`${apiBaseUrl}/`, () => {
      controller.abort();
      return HttpResponse.error();
    }),
  );
  const runtime = new ApiRequestRuntime(apiBaseUrl);
  const failures: ApiNetworkError[] = [];
  runtime.setOnNetworkFailure((error) => failures.push(error));

  const result = await runtime.responseRequest(
    "/",
    "GET",
    undefined,
    { signal: controller.signal },
    [],
    getHealthOperation,
  );

  expect(result).toMatchObject({ ok: false, kind: "cancelled" });
  expect(failures).toEqual([]);
});
