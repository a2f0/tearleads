import { expect } from "bun:test";
import { apiVersionHeaderName } from "@tearleads/validators/operation";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

function healthResponse(status: number, apiVersion?: string): Response {
  return HttpResponse.json(
    status === 200 ? { message: "ok" } : { error: "Internal Server Error" },
    {
      status,
      headers:
        apiVersion === undefined ? {} : { [apiVersionHeaderName]: apiVersion },
    },
  );
}

testApiClient(
  "reports the API build named by successful and failed responses",
  async () => {
    const responses = [
      healthResponse(200, "2460"),
      healthResponse(500, "2461"),
    ];
    server.use(http.get(`${apiBaseUrl}/`, () => responses.shift()));
    const client = new ApiClient(apiBaseUrl);
    const versions: number[] = [];
    client.setOnApiVersion((version) => versions.push(version));

    await client.getHealth();
    await client.getHealth();

    expect(versions).toEqual([2460, 2461]);
  },
);

testApiClient("ignores responses without a readable API build", async () => {
  const responses = [healthResponse(200), healthResponse(200, "v2461")];
  server.use(http.get(`${apiBaseUrl}/`, () => responses.shift()));
  const client = new ApiClient(apiBaseUrl);
  const versions: number[] = [];
  client.setOnApiVersion((version) => versions.push(version));

  await client.getHealth();
  await client.getHealth();

  expect(versions).toEqual([]);
});
