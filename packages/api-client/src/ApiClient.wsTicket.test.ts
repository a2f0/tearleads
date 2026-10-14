import { expect } from "bun:test";
import { generateSigningKeyPair } from "@tearleads/crypto";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient(
  "returns the websocket ticket from a successful mint",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/auth/ws-ticket`, () =>
        HttpResponse.json({ ticket: "ticket-abc" }),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("bearer-token");

    await expect(client.requestWebSocketTicket()).resolves.toBe("ticket-abc");
  },
);

testApiClient(
  "returns null when the ticket request is unauthorized",
  async () => {
    server.use(
      http.post(
        `${apiBaseUrl}/auth/ws-ticket`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );

    const client = new ApiClient(apiBaseUrl);

    await expect(client.requestWebSocketTicket()).resolves.toBeNull();
  },
);

testApiClient("returns null when the ticket payload is malformed", async () => {
  server.use(
    http.post(`${apiBaseUrl}/auth/ws-ticket`, () =>
      HttpResponse.json({ notATicket: true }),
    ),
  );

  const client = new ApiClient(apiBaseUrl);

  await expect(client.requestWebSocketTicket()).resolves.toBeNull();
});

testApiClient(
  "validates the failure body after a session-refresh retry",
  async () => {
    let requestCount = 0;
    server.use(
      http.post(`${apiBaseUrl}/auth/ws-ticket`, () => {
        requestCount += 1;
        return HttpResponse.json(
          requestCount === 1
            ? {
                code: SESSION_ERROR_CODES.refreshRequired,
                error: "Session expired",
              }
            : { code: "unknown_code", error: "Untrusted retry detail" },
          { status: 401 },
        );
      }),
    );

    const errors: string[] = [];
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("stale-token");
    client.setOnError((message) => errors.push(message));
    client.setOnSessionExpired(() => {
      client.setAuthToken("fresh-token");
      return true;
    });

    await expect(client.requestWebSocketTicket()).resolves.toBeNull();

    expect(requestCount).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Invalid failure response body");
    expect(errors[0]).not.toContain("Untrusted retry detail");
  },
);

testApiClient(
  "login returns the first ticket and later connects mint their own",
  async () => {
    let minted = 0;
    server.use(
      http.post(`${apiBaseUrl}/auth/challenge`, () =>
        HttpResponse.json({ challenge: "a".repeat(64) }),
      ),
      http.post(`${apiBaseUrl}/auth/verify`, () =>
        HttpResponse.json({
          authenticated: true,
          isRoot: false,
          organizationId: "organization-1",
          rootContainerId: null,
          token: "token-1",
          userId: "user-1",
          wsTicket: "login-ticket",
        }),
      ),
      http.post(`${apiBaseUrl}/auth/ws-ticket`, () => {
        minted += 1;
        return HttpResponse.json({ ticket: `minted-${minted}` });
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    const { signingPrivateKey } = generateSigningKeyPair(new Uint8Array(32));

    const login = await client.authenticate("b".repeat(64), signingPrivateKey);
    expect(login?.wsTicket).toBe("login-ticket");
    client.setAuthToken("token-1");

    await expect(client.requestWebSocketTicket()).resolves.toBe("login-ticket");
    expect(minted).toBe(0);
    await expect(client.requestWebSocketTicket()).resolves.toBe("minted-1");
  },
);
