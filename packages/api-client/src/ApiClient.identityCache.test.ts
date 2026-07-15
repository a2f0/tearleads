import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { createEncapsulationKeyResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient("evicts one cached raw identity response", async () => {
  let requestCount = 0;
  server.use(
    http.get(`${apiBaseUrl}/auth/encapsulation-key/:userId`, ({ params }) => {
      requestCount += 1;
      const { userId } = params as { userId: string };
      return HttpResponse.json(createEncapsulationKeyResponse(userId));
    }),
  );
  const client = new ApiClient(apiBaseUrl);

  await client.getEncapsulationKey("user-1");
  await client.getEncapsulationKey("user-1");
  expect(requestCount).toBe(1);

  client.evictEncapsulationKey("user-1");
  await client.getEncapsulationKey("user-1");
  expect(requestCount).toBe(2);
});
