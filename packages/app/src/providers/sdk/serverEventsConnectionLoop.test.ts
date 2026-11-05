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

// The SDK opens the real socket (api-client's openServerEventsSocket); the
// loop only hands it each ticket.
function socketOpener(sockets: FakeSocket[]): (ticket: string) => WebSocket {
  return (ticket) => {
    const socket = new FakeSocket(
      `ws://events.example.test/events?ticket=${ticket}`,
    );
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
}

function noSocketExpected(): WebSocket {
  throw new Error("This test never opens a socket");
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("does not rebind timer dependency receivers", async () => {
  let watchdogCallback: (() => void) | null = null;
  let clearedWatchdog: unknown;
  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => undefined,
      onMessage: () => undefined,
      onOpen: () => undefined,
      requestTicket: async () => null,
      openSocket: noSocketExpected,
    },
    {
      clearWatchdog: function (this: unknown, timer) {
        expect(this).toBeUndefined();
        clearedWatchdog = timer;
      },
      scheduleTimer: () => 2,
      scheduleWatchdog: function (this: unknown, callback) {
        expect(this).toBeUndefined();
        watchdogCallback = callback;
        return 1;
      },
    },
  );

  await flushAsyncWork();
  expect(clearedWatchdog).toBe(1);
  expect(watchdogCallback).not.toBeNull();
  stop();
});

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
      openSocket: socketOpener(sockets),
    },
    {
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
      openSocket: noSocketExpected,
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
      openSocket: socketOpener(sockets),
    },
    {
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
      openSocket: socketOpener(sockets),
    },
    {
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

test("retries when ticket minting never settles", async () => {
  const reconnectTimers: Array<{ callback: () => void; delayMs: number }> = [];
  const watchdogs: Array<{ callback: () => void; delayMs: number }> = [];
  let ticketRequests = 0;

  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => undefined,
      onMessage: () => undefined,
      onOpen: () => undefined,
      requestTicket: () => {
        ticketRequests += 1;
        return new Promise(() => {});
      },
      openSocket: noSocketExpected,
    },
    {
      random: () => 0.5,
      scheduleTimer: (callback, delayMs) => {
        reconnectTimers.push({ callback, delayMs });
        return reconnectTimers.length as unknown as ReturnType<
          typeof setTimeout
        >;
      },
      scheduleWatchdog: (callback, delayMs) => {
        watchdogs.push({ callback, delayMs });
        return watchdogs.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  expect(ticketRequests).toBe(1);
  expect(watchdogs[0]?.delayMs).toBe(15_000);
  watchdogs[0]?.callback();
  await flushAsyncWork();

  expect(reconnectTimers).toHaveLength(1);
  expect(reconnectTimers[0]?.delayMs).toBe(500);
  reconnectTimers[0]?.callback();
  await flushAsyncWork();
  expect(ticketRequests).toBe(2);

  stop();
});

test("closes and retries a socket whose opening handshake stalls", async () => {
  const sockets: FakeSocket[] = [];
  const reconnectTimers: Array<{ callback: () => void; delayMs: number }> = [];
  const watchdogs: Array<{ callback: () => void; delayMs: number }> = [];
  let disconnects = 0;

  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => {
        disconnects += 1;
      },
      onMessage: () => undefined,
      onOpen: () => undefined,
      requestTicket: async () => "ticket",
      openSocket: socketOpener(sockets),
    },
    {
      random: () => 0.5,
      scheduleTimer: (callback, delayMs) => {
        reconnectTimers.push({ callback, delayMs });
        return reconnectTimers.length as unknown as ReturnType<
          typeof setTimeout
        >;
      },
      scheduleWatchdog: (callback, delayMs) => {
        watchdogs.push({ callback, delayMs });
        return watchdogs.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  await flushAsyncWork();
  // The first watchdog guarded ticket minting and was cleared; the second owns
  // the WebSocket opening handshake.
  expect(watchdogs).toHaveLength(2);
  expect(watchdogs[1]?.delayMs).toBe(15_000);
  watchdogs[1]?.callback();

  expect(sockets[0]?.closeCalls).toBe(1);
  expect(disconnects).toBe(1);
  expect(reconnectTimers[0]?.delayMs).toBe(500);

  stop();
});

test("reports each attempt's start and a failure before any socket binds", async () => {
  const sockets: FakeSocket[] = [];
  const timers: Array<() => void> = [];
  const tickets: Array<string | null> = [null, "ticket"];
  const calls: string[] = [];
  const stop = startServerEventsConnectionLoop(
    {
      onAttemptFailed: () => calls.push("failed"),
      onAttemptStart: () => calls.push("start"),
      onDisconnect: () => calls.push("disconnect"),
      onMessage: () => undefined,
      onOpen: () => calls.push("open"),
      requestTicket: async () => tickets.shift() ?? null,
      openSocket: socketOpener(sockets),
    },
    {
      random: () => 0.5,
      scheduleTimer: (callback) => {
        timers.push(callback);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  await flushAsyncWork();
  // No ticket: the attempt ends before a socket exists.
  expect(calls).toEqual(["start", "failed"]);

  timers.shift()?.();
  await flushAsyncWork();
  sockets[0]?.open();
  sockets[0]?.close();
  // A bound socket ends its attempt through the disconnect callback alone.
  expect(calls).toEqual(["start", "failed", "start", "open", "disconnect"]);
  stop();
});

test("a ticket from a timed-out attempt never opens a socket", async () => {
  const sockets: FakeSocket[] = [];
  const reconnectTimers: Array<() => void> = [];
  const watchdogs: Array<() => void> = [];
  const pendingTickets: Array<(ticket: string) => void> = [];
  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => undefined,
      onMessage: () => undefined,
      onOpen: () => undefined,
      requestTicket: () =>
        new Promise<string>((resolve) => {
          pendingTickets.push(resolve);
        }),
      openSocket: socketOpener(sockets),
    },
    {
      random: () => 0.5,
      scheduleTimer: (callback) => {
        reconnectTimers.push(callback);
        return reconnectTimers.length as unknown as ReturnType<
          typeof setTimeout
        >;
      },
      scheduleWatchdog: (callback) => {
        watchdogs.push(callback);
        return watchdogs.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  // Attempt 1 times out and attempt 2 replaces it.
  watchdogs[0]?.();
  await flushAsyncWork();
  reconnectTimers[0]?.();
  await flushAsyncWork();
  expect(pendingTickets).toHaveLength(2);

  // Attempt 1's ticket arrives late; only attempt 2's opens a socket.
  pendingTickets[0]?.("stale-ticket");
  await flushAsyncWork();
  expect(sockets).toHaveLength(0);
  pendingTickets[1]?.("fresh-ticket");
  await flushAsyncWork();
  expect(sockets.map((socket) => socket.url)).toEqual([
    "ws://events.example.test/events?ticket=fresh-ticket",
  ]);

  stop();
});

test("a replaced socket's late events reach nothing", async () => {
  const sockets: FakeSocket[] = [];
  const timers: Array<() => void> = [];
  const calls: string[] = [];
  const stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => calls.push("disconnect"),
      onMessage: (ws) =>
        calls.push(`message ${sockets.indexOf(ws as unknown as FakeSocket)}`),
      onOpen: (ws) =>
        calls.push(`open ${sockets.indexOf(ws as unknown as FakeSocket)}`),
      requestTicket: async () => "ticket",
      openSocket: socketOpener(sockets),
    },
    {
      random: () => 0.5,
      scheduleTimer: (callback) => {
        timers.push(callback);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  await flushAsyncWork();
  sockets[0]?.open();
  sockets[0]?.close();
  timers[0]?.();
  await flushAsyncWork();
  sockets[1]?.open();

  sockets[0]?.open();
  sockets[0]?.dispatchEvent(new MessageEvent("message", { data: "late" }));
  sockets[0]?.dispatchEvent(new Event("close"));
  sockets[1]?.dispatchEvent(new MessageEvent("message", { data: "live" }));
  expect(calls).toEqual(["open 0", "disconnect", "open 1", "message 1"]);
  expect(timers).toHaveLength(1);

  stop();
});

test("stopping from inside onDisconnect schedules no reconnect", async () => {
  const sockets: FakeSocket[] = [];
  const timers: Array<() => void> = [];
  let stop: () => void = () => undefined;
  stop = startServerEventsConnectionLoop(
    {
      onDisconnect: () => stop(),
      onMessage: () => undefined,
      onOpen: () => undefined,
      requestTicket: async () => "ticket",
      openSocket: socketOpener(sockets),
    },
    {
      scheduleTimer: (callback) => {
        timers.push(callback);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );

  await flushAsyncWork();
  sockets[0]?.open();
  sockets[0]?.close();
  expect(timers).toHaveLength(0);
});
