import { expect, test } from "bun:test";
import { startServerEventsConnectionLoop } from "./serverEventsConnectionLoop";

class FakeSocket extends EventTarget {
  closeCalls = 0;

  constructor(readonly url: string) {
    super();
  }

  close(): void {
    this.closeCalls += 1;
    this.dispatchEvent(new Event("close"));
  }

  open(): void {
    this.dispatchEvent(new Event("open"));
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("reconnects with a fresh ticket and coalesces error plus close", async () => {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const tickets = ["ticket-one", "ticket-two"];
  let disconnects = 0;
  let opens = 0;
  let ticketRequests = 0;

  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => {
        disconnects += 1;
      },
      onMessage: () => undefined,
      onOpen: () => {
        opens += 1;
      },
      requestTicket: async () => {
        const ticket = tickets[ticketRequests] ?? null;
        ticketRequests += 1;
        return ticket;
      },
      wsUrl: "ws://events.example.test/events?existing=value",
    },
    {
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      random: () => 0.5,
      scheduleTimer: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  await flushAsyncWork();
  expect(ticketRequests).toBe(1);
  expect(sockets).toHaveLength(1);
  expect(sockets[0]?.url).toContain("existing=value");
  expect(sockets[0]?.url).toContain("ticket=ticket-one");

  sockets[0]?.open();
  expect(opens).toBe(1);
  sockets[0]?.dispatchEvent(new Event("error"));
  expect(sockets[0]?.closeCalls).toBe(1);
  expect(disconnects).toBe(1);
  expect(timers).toHaveLength(1);
  expect(timers[0]?.delayMs).toBe(500);

  timers[0]?.callback();
  await flushAsyncWork();
  expect(ticketRequests).toBe(2);
  expect(sockets).toHaveLength(2);
  expect(sockets[1]?.url).toContain("ticket=ticket-two");
  sockets[1]?.open();
  expect(opens).toBe(2);

  stop();
  expect(sockets[1]?.closeCalls).toBe(1);
  expect(disconnects).toBe(2);
  expect(timers).toHaveLength(1);
});

test("cancels a pending reconnect without minting another ticket", async () => {
  const timers: Array<() => void> = [];
  const cleared: unknown[] = [];
  let ticketRequests = 0;
  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => undefined,
      onMessage: () => undefined,
      onOpen: () => undefined,
      requestTicket: async () => {
        ticketRequests += 1;
        return null;
      },
      wsUrl: "ws://events.example.test/events",
    },
    {
      clearTimer: (timer) => cleared.push(timer),
      scheduleTimer: (callback) => {
        timers.push(callback);
        return 41 as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  await flushAsyncWork();
  expect(ticketRequests).toBe(1);
  expect(timers).toHaveLength(1);
  stop();
  expect(cleared).toEqual([41]);

  timers[0]?.();
  await flushAsyncWork();
  expect(ticketRequests).toBe(1);
});

test("open-then-immediate-close failures retain exponential backoff", async () => {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  let ticketRequests = 0;
  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => undefined,
      onMessage: () => undefined,
      onOpen: () => undefined,
      requestTicket: async () => {
        ticketRequests += 1;
        return `ticket-${ticketRequests}`;
      },
      wsUrl: "ws://events.example.test/events",
    },
    {
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      now: () => 0,
      random: () => 0.5,
      scheduleTimer: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  await flushAsyncWork();
  sockets[0]?.open();
  sockets[0]?.dispatchEvent(new Event("close"));
  expect(timers[0]?.delayMs).toBe(500);

  timers[0]?.callback();
  await flushAsyncWork();
  sockets[1]?.open();
  sockets[1]?.dispatchEvent(new Event("close"));
  expect(timers[1]?.delayMs).toBe(1_000);

  timers[1]?.callback();
  await flushAsyncWork();
  sockets[2]?.open();
  sockets[2]?.dispatchEvent(new Event("close"));
  expect(timers[2]?.delayMs).toBe(2_000);
  expect(ticketRequests).toBe(3);

  stop();
});

test("a stable connection resets reconnect backoff", async () => {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  let nowMs = 0;
  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => undefined,
      onMessage: () => undefined,
      onOpen: () => undefined,
      requestTicket: async () => "ticket",
      wsUrl: "ws://events.example.test/events",
    },
    {
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      now: () => nowMs,
      random: () => 0.5,
      scheduleTimer: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  await flushAsyncWork();
  sockets[0]?.open();
  sockets[0]?.dispatchEvent(new Event("close"));
  expect(timers[0]?.delayMs).toBe(500);

  timers[0]?.callback();
  await flushAsyncWork();
  sockets[1]?.open();
  nowMs = 10_000;
  sockets[1]?.dispatchEvent(new Event("close"));
  expect(timers[1]?.delayMs).toBe(500);

  stop();
});
