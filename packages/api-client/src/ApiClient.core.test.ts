import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { ApiClient } from "./ApiClient";
import {
  createContainerMutationRequest,
  createDocumentSyncRequest,
  createEncapsulationKeyResponse,
} from "./ApiClient.testFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "./ApiClient.testHarness";

testApiClient(
  "normalizes base URL and includes authorization headers",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.get(`${apiBaseUrl}/`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json({ message: "ok" });
      }),
    );

    const client = new ApiClient(`${apiBaseUrl}/`);
    client.setAuthToken("abc");

    await client.getHealth();

    const call = calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("expected getHealth HTTP call");
    }
    expect(call.authorization).toBe("Bearer abc");
    expect(call.contentType).toBeNull();
    expect(call.url).toBe(`${apiBaseUrl}/`);
  },
);

testApiClient("accepts missing base URL inputs", () => {
  expect(new ApiClient().getAuthToken()).toBeNull();
  expect(new ApiClient(null).getAuthToken()).toBeNull();
});

testApiClient(
  "allows public methods to be called after destructuring",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.get(`${apiBaseUrl}/`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json({ message: "ok" });
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const { getHealth, setAuthToken } = client;

    setAuthToken("abc");
    await getHealth();

    const call = calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("expected destructured getHealth HTTP call");
    }
    expect(call.authorization).toBe("Bearer abc");
    expect(call.contentType).toBeNull();
  },
);

testApiClient("escapes dynamic route path segments", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.get(
      `${apiBaseUrl}/auth/encapsulation-key/:userId`,
      async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json(
          createEncapsulationKeyResponse("user/id with space"),
        );
      },
    ),
  );

  const client = new ApiClient(apiBaseUrl);

  await expect(
    client.getEncapsulationKey("user/id with space"),
  ).resolves.toEqual({
    encapsulationPublicKey: "encapsulation-key",
    signingKeyFingerprint: "a".repeat(64),
    signingPublicKey: "signing-key",
    userId: "user/id with space",
  });

  expect(calls[0]?.url).toBe(
    `${apiBaseUrl}/auth/encapsulation-key/user%2Fid%20with%20space`,
  );
});

testApiClient(
  "caches encapsulation key requests until auth changes",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/auth/encapsulation-key/:userId`,
        async ({ params, request }) => {
          calls.push(await captureHttpCall(request));
          const { userId } = params as { userId: string };
          return HttpResponse.json(createEncapsulationKeyResponse(userId));
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("token-1");

    const [first, second] = await Promise.all([
      client.getEncapsulationKey("user-1"),
      client.getEncapsulationKey("user-1"),
    ]);
    const third = await client.getEncapsulationKey("user-1");
    client.setAuthToken("token-2");
    const fourth = await client.getEncapsulationKey("user-1");

    expect(first).toEqual(createEncapsulationKeyResponse("user-1"));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(fourth).toEqual(first);
    expect(
      calls.map((call) => ({
        authorization: call.authorization,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        authorization: "Bearer token-1",
        input: `${apiBaseUrl}/auth/encapsulation-key/user-1`,
        method: "GET",
      },
      {
        authorization: "Bearer token-2",
        input: `${apiBaseUrl}/auth/encapsulation-key/user-1`,
        method: "GET",
      },
    ]);
  },
);

testApiClient("uses auth session management routes", async () => {
  const calls: CapturedHttpCall[] = [];
  const sessionId = "a".repeat(64);
  server.use(
    http.all(`${apiBaseUrl}/auth/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));

      if (request.method === "GET" && request.url.endsWith("/sessions")) {
        return HttpResponse.json({
          sessions: [
            {
              id: sessionId,
              createdAt: "2026-05-22T12:00:00.000Z",
              ipAddresses: ["198.51.100.10"],
              isCurrent: true,
              lastActiveAt: "2026-05-22T12:05:00.000Z",
              lastActiveIp: "198.51.100.10",
              signingKeyFingerprint: "signing-fingerprint",
            },
          ],
        });
      }

      return HttpResponse.json({ message: "ok" });
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  client.setAuthToken("abc");

  expect(await client.listSessions()).toEqual({
    sessions: [
      {
        id: sessionId,
        createdAt: "2026-05-22T12:00:00.000Z",
        ipAddresses: ["198.51.100.10"],
        isCurrent: true,
        lastActiveAt: "2026-05-22T12:05:00.000Z",
        lastActiveIp: "198.51.100.10",
        signingKeyFingerprint: "signing-fingerprint",
      },
    ],
  });
  expect(await client.destroySession(sessionId)).toEqual({ message: "ok" });
  expect(await client.logout()).toEqual({ message: "ok" });

  expect(
    calls.map((call) => ({
      authorization: call.authorization,
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      authorization: "Bearer abc",
      body: null,
      input: `${apiBaseUrl}/auth/sessions`,
      method: "GET",
    },
    {
      authorization: "Bearer abc",
      body: "",
      input: `${apiBaseUrl}/auth/sessions/${sessionId}`,
      method: "DELETE",
    },
    {
      authorization: "Bearer abc",
      body: "",
      input: `${apiBaseUrl}/auth/logout`,
      method: "POST",
    },
  ]);
});

testApiClient("returns null on network error", async () => {
  server.use(
    http.get(`${apiBaseUrl}/`, () => {
      return HttpResponse.error();
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  expect(await client.getHealth()).toBeNull();
});

testApiClient(
  "includes backend error details in onError output for non-2xx responses",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/containers/:containerId/share`, () => {
        return HttpResponse.json(
          {
            error: "Stale container manifest",
          },
          {
            status: 409,
            statusText: "Conflict",
          },
        );
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setOnError((message) => {
      errors.push(message);
    });

    expect(
      await client.shareContainer(
        "container-1",
        createContainerMutationRequest(),
      ),
    ).toBeNull();
    expect(errors).toEqual([
      "POST /containers/container-1/share: 409 Conflict: Stale container manifest",
    ]);
  },
);

testApiClient(
  "renews expired auth tokens and retries the original request",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/auth/encapsulation-key/:userId`,
        async ({ params, request }) => {
          calls.push(await captureHttpCall(request));
          if (request.headers.get("authorization") === "Bearer stale-token") {
            return HttpResponse.json(
              { error: "Session expired" },
              { status: 401, statusText: "Unauthorized" },
            );
          }

          const { userId } = params as { userId: string };
          return HttpResponse.json(createEncapsulationKeyResponse(userId));
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    let refreshCalls = 0;
    client.setAuthToken("stale-token");
    client.setOnError((message) => {
      errors.push(message);
    });
    client.setOnSessionExpired(() => {
      refreshCalls += 1;
      client.setAuthToken("fresh-token");
      return true;
    });

    await expect(client.getEncapsulationKey("user-1")).resolves.toEqual(
      createEncapsulationKeyResponse("user-1"),
    );

    expect(refreshCalls).toBe(1);
    expect(errors).toEqual([]);
    expect(
      calls.map((call) => ({
        authorization: call.authorization,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        authorization: "Bearer stale-token",
        input: `${apiBaseUrl}/auth/encapsulation-key/user-1`,
        method: "GET",
      },
      {
        authorization: "Bearer fresh-token",
        input: `${apiBaseUrl}/auth/encapsulation-key/user-1`,
        method: "GET",
      },
    ]);
  },
);

testApiClient(
  "reports the session error when renewal throws synchronously",
  async () => {
    server.use(
      http.get(`${apiBaseUrl}/auth/encapsulation-key/:userId`, () =>
        HttpResponse.json(
          { error: "Session expired" },
          { status: 401, statusText: "Unauthorized" },
        ),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setAuthToken("stale-token");
    client.setOnError((message) => {
      errors.push(message);
    });
    client.setOnSessionExpired(() => {
      throw new Error("local key unavailable");
    });

    await expect(client.getEncapsulationKey("user-1")).resolves.toBeNull();

    // The thrown renewal error is surfaced as a diagnostic (so a failing silent
    // re-auth is not swallowed) in addition to the downstream 401.
    expect(errors).toEqual([
      "Session refresh failed: local key unavailable",
      "GET /auth/encapsulation-key/user-1: 401 Unauthorized: Session expired",
    ]);
  },
);

testApiClient("does not renew expired sessions for logout", async () => {
  server.use(
    http.post(`${apiBaseUrl}/auth/logout`, () => {
      return HttpResponse.json(
        { error: "Session expired" },
        { status: 401, statusText: "Unauthorized" },
      );
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const errors: string[] = [];
  let refreshCalls = 0;
  client.setAuthToken("stale-token");
  client.setOnError((message) => {
    errors.push(message);
  });
  client.setOnSessionExpired(() => {
    refreshCalls += 1;
    client.setAuthToken("fresh-token");
    return true;
  });

  await expect(client.logout()).resolves.toBeNull();

  expect(refreshCalls).toBe(0);
  expect(errors).toEqual([
    "POST /auth/logout: 401 Unauthorized: Session expired",
  ]);
});

testApiClient(
  "returns document sync failures without reporting when requested",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/documents/:documentId/sync`, () => {
        return HttpResponse.json(
          {
            error: "Document KEK targets are stale",
          },
          {
            status: 409,
            statusText: "Conflict",
          },
        );
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setOnError((message) => {
      errors.push(message);
    });

    const result = await client.syncDocumentResult(
      "document-1",
      createDocumentSyncRequest(),
      { reportErrors: false },
    );

    expect(result.ok).toBe(false);
    expect(errors).toEqual([]);
    if (result.ok) {
      throw new Error("Expected document sync result failure");
    }
    expect(result.status).toBe(409);
    expect(result.message).toBe(
      "POST /documents/document-1/sync: 409 Conflict: Document KEK targets are stale",
    );

    result.report();
    expect(errors).toEqual([
      "POST /documents/document-1/sync: 409 Conflict: Document KEK targets are stale",
    ]);
  },
);
