import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { server } from "../../test/helpers/mswServer";
import { ApiClient } from "./ApiClient";

beforeAll(() => server.listen());

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

test("rejects and reports network failures", async () => {
  const client = new ApiClient("http://api.test");
  const errors: string[] = [];
  let networkErrors = 0;
  let networkSuccesses = 0;

  client.setOnError((message) => errors.push(message));
  client.setOnNetworkError(() => {
    networkErrors += 1;
  });
  client.setOnNetworkSuccess(() => {
    networkSuccesses += 1;
  });

  server.use(
    http.get("http://api.test/", () => {
      return HttpResponse.error();
    }),
  );

  const result = await client.getHealth();
  expect(result).toBeNull();
  expect(errors).toEqual(["GET /: Failed to fetch"]);
  expect(networkErrors).toBe(1);
  expect(networkSuccesses).toBe(0);
});

test("marks successful responses as online", async () => {
  const client = new ApiClient("http://api.test");
  let networkErrors = 0;
  let networkSuccesses = 0;

  client.setOnNetworkError(() => {
    networkErrors += 1;
  });
  client.setOnNetworkSuccess(() => {
    networkSuccesses += 1;
  });

  server.use(
    http.get("http://api.test/", () => {
      return HttpResponse.json({ message: "ok" });
    }),
  );

  await expect(client.getHealth()).resolves.toEqual({ message: "ok" });
  expect(networkErrors).toBe(0);
  expect(networkSuccesses).toBe(1);
});
