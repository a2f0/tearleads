import { expect } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
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
      http.get(`${apiBaseUrl}/auth/encapsulation-key/:userId`, () =>
        HttpResponse.json(
          { error: "Session expired" },
          { status: 401, statusText: "Unauthorized" },
        ),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("stale-token");
    client.setOnSessionExpired(async () => {
      throw mismatch;
    });

    await expect(client.getEncapsulationKey("user-1")).rejects.toBe(mismatch);
  },
);
