import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { ApiClient } from "./ApiClient";
import { apiBaseUrl, server, testApiClient } from "./ApiClient.testHarness";

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
