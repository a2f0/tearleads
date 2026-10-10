import { expect } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const expired = () =>
  HttpResponse.json(
    { code: SESSION_ERROR_CODES.refreshRequired, error: "Expired session" },
    { status: 401 },
  );
const deleted = () =>
  HttpResponse.json({
    containerId: "target",
    deletedAt: "2026-10-10T00:00:00.000Z",
  });
const path = `${apiBaseUrl}/containers/target`;

for (const replacement of ["identity-b", null]) {
  testApiClient(
    `a delayed DELETE 401 cannot cross a token replacement (${replacement})`,
    async () => {
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("identity-a");
      let refreshes = 0;
      const calls: (string | null)[] = [];
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      client.setOnSessionExpired(() => {
        refreshes += 1;
        return false;
      });
      server.use(
        http.delete(path, async ({ request }) => {
          calls.push(request.headers.get("Authorization"));
          if (calls.length > 1) return deleted();
          entered.resolve();
          await release.promise;
          return expired();
        }),
      );
      const pending = client.deleteContainerResult("target", {
        reportErrors: false,
      });
      await entered.promise;
      client.setAuthToken(replacement);
      release.resolve();
      expect((await pending).ok).toBe(false);
      expect(calls).toEqual(["Bearer identity-a"]);
      expect(refreshes).toBe(0);
    },
  );
}

for (const switches of [false, true]) {
  testApiClient(
    `DELETE renewal cannot adopt a later identity (switch: ${switches})`,
    async () => {
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("identity-a");
      const renewed = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const calls: (string | null)[] = [];
      client.setOnSessionExpired(async () => {
        client.setAuthToken("identity-a-renewed");
        renewed.resolve();
        await release.promise;
        return true;
      });
      server.use(
        http.delete(path, ({ request }) => {
          calls.push(request.headers.get("Authorization"));
          return calls.length === 1 ? expired() : deleted();
        }),
      );
      const pending = client.deleteContainerResult("target", {
        reportErrors: false,
      });
      await renewed.promise;
      if (switches) client.setAuthToken("identity-b");
      release.resolve();
      expect((await pending).ok).toBe(!switches);
      expect(calls).toEqual(
        switches
          ? ["Bearer identity-a"]
          : ["Bearer identity-a", "Bearer identity-a-renewed"],
      );
    },
  );
}

testApiClient(
  "a renewal notification cannot redirect the replay to another identity",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("identity-a");
    const calls: (string | null)[] = [];
    client.setOnSessionExpired(() => {
      client.setAuthToken("identity-a-renewed");
      return true;
    });
    server.use(
      http.delete(path, ({ request }) => {
        calls.push(request.headers.get("Authorization"));
        return calls.length === 1 ? expired() : deleted();
      }),
    );
    const result = await client.deleteContainerResult("target", {
      reportErrors: false,
      onSessionRenewed: () => {
        client.setAuthToken("identity-b");
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toEqual(["Bearer identity-a"]);
  },
);
