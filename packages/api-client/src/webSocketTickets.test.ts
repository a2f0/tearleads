import { expect, test } from "bun:test";
import type { OperationTransport } from "./operationTransportFactory";
import { openServerEventsSocket, WebSocketTickets } from "./webSocketTickets";

const LOGIN = {
  authenticated: true as const,
  isRoot: false,
  organizationId: "organization-1",
  rootContainerId: null,
  token: "token-1",
  userId: "user-1",
  wsTicket: "login-ticket",
};

function harness() {
  let now = 1_000;
  let token: string | null = LOGIN.token;
  let minted = 0;
  const transport = {
    request: async () => {
      minted += 1;
      return { ticket: `minted-${minted}` };
    },
  } as unknown as Pick<OperationTransport, "request">;
  const tickets = new WebSocketTickets(
    transport,
    () => token,
    () => now,
  );
  return {
    tickets,
    minted: () => minted,
    advance: (ms: number) => {
      now += ms;
    },
    setToken: (next: string | null) => {
      token = next;
    },
  };
}

test("the first connect after login uses the login ticket exactly once", async () => {
  const h = harness();
  h.tickets.rememberLogin(LOGIN);
  expect(await h.tickets.next()).toBe("login-ticket");
  expect(h.minted()).toBe(0);
  // A ticket is single use: the reconnect mints its own.
  expect(await h.tickets.next()).toBe("minted-1");
  expect(h.minted()).toBe(1);
});

test("a login ticket is never handed to a different session", async () => {
  const h = harness();
  h.tickets.rememberLogin(LOGIN);
  h.setToken("token-2");
  expect(await h.tickets.next()).toBe("minted-1");
  // Discarded, not retained for a later return of the first token.
  h.setToken(LOGIN.token);
  expect(await h.tickets.next()).toBe("minted-2");
});

test("a login ticket past half the ticket lifetime is replaced by a mint", async () => {
  const h = harness();
  h.tickets.rememberLogin(LOGIN);
  h.advance(29_999);
  expect(await h.tickets.next()).toBe("login-ticket");
  h.tickets.rememberLogin(LOGIN);
  h.advance(30_000);
  expect(await h.tickets.next()).toBe("minted-1");
});

test("without a login every connect mints a ticket", async () => {
  const h = harness();
  expect(await h.tickets.next()).toBe("minted-1");
  expect(await h.tickets.next()).toBe("minted-2");
});

test("opens the events socket with the ticket, keeping other parameters", () => {
  const urls: string[] = [];
  const socket = {} as WebSocket;
  expect(
    openServerEventsSocket(
      "wss://api.example.test/events?existing=value&ticket=stale",
      "fresh-ticket",
      (url) => {
        urls.push(url);
        return socket;
      },
    ),
  ).toBe(socket);
  expect(urls).toEqual([
    "wss://api.example.test/events?existing=value&ticket=fresh-ticket",
  ]);
});
