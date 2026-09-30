import { expect } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient(
  "identity integrity failures propagate from renewal",
  async () => {
    const mismatch = new KeyingVerificationError(
      "equivocation",
      "Local identity does not match its durable pin",
    );
    server.use(
      http.get(`${apiBaseUrl}/auth/user-identity/:userId`, () =>
        HttpResponse.json(
          {
            code: SESSION_ERROR_CODES.refreshRequired,
            error: "Session expired",
          },
          { status: 401, statusText: "Unauthorized" },
        ),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("stale-token");
    client.setOnSessionExpired(async () => {
      throw mismatch;
    });

    await expect(client.getUserIdentity("user-1")).rejects.toBe(mismatch);
  },
);

testApiClient(
  "a user identity body dropped mid-stream is unavailable, not malformed",
  async () => {
    server.use(
      http.get(
        `${apiBaseUrl}/auth/user-identity/:userId`,
        () =>
          new HttpResponse(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"userId":'));
                controller.error(
                  new TypeError("The network connection was lost."),
                );
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    let networkErrors = 0;
    client.setOnNetworkError(() => {
      networkErrors += 1;
    });
    expect(await client.getUserIdentity("user-1")).toBeNull();
    expect(client.getUserIdentityRequestFailure("user-1")).toMatchObject({
      kind: "network",
    });
    expect(networkErrors).toBe(1);
  },
);
