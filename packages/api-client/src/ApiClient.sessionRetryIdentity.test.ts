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

for (const route of ["health", "sessions"] as const) {
  testApiClient(
    `a buffered ${route} reply finishing after a new sign-in is discarded`,
    async () => {
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("first");
      const reading = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<void>();
      const originalFetch = globalThis.fetch;
      const payload = route === "health" ? { message: "ok" } : { sessions: [] };
      class BufferedResponse extends Response {
        override async json() {
          reading.resolve();
          await finish.promise;
          return payload;
        }
      }
      globalThis.fetch = Object.assign(
        async () => new BufferedResponse(null, { status: 200 }),
        originalFetch,
      );
      try {
        const pending =
          route === "health" ? client.getHealth() : client.listSessions();
        await reading.promise;
        if (route === "sessions") client.setAuthToken(null);
        else client.setAuthToken("second", { boundary: "replacement" });
        finish.resolve();
        await expect(pending).resolves.toBeNull();
      } finally {
        finish.resolve();
        globalThis.fetch = originalFetch;
      }
    },
  );
}

testApiClient(
  "an independent sign-in releases requests waiting on the former session's renewal",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("first");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<boolean>();
    const errors: string[] = [];
    client.setOnError((error) => errors.push(error));
    client.setOnSessionExpired(() => {
      entered.resolve();
      return release.promise;
    });
    server.use(http.delete(path, expired));
    const request = client.deleteContainerResult("target", {
      reportErrors: false,
    });
    await entered.promise;
    client.setAuthToken("second", { boundary: "replacement" });
    try {
      const settled = await Promise.race([
        request,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
      ]);
      expect(settled).toMatchObject({ ok: false, kind: "cancelled" });
    } finally {
      release.reject(new Error("Delayed renewal failed"));
      await Promise.resolve();
    }
    expect(errors).toEqual([]);
  },
);

testApiClient(
  "renewal cannot replay a write after its organization retires",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("original");
    let current = true;
    let attempts = 0;
    client.setOnSessionExpired(() => {
      client.setAuthToken("renewed");
      current = false;
      return true;
    });
    server.use(
      http.delete(path, () => (++attempts === 1 ? expired() : deleted())),
    );
    const result = await client.deleteContainerResult("target", {
      stillCurrent: () => current,
      reportErrors: false,
    });
    expect(result).toMatchObject({ ok: false, kind: "cancelled" });
    expect(attempts).toBe(1);
  },
);
