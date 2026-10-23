import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { createDiscardReports } from "./discardReports";
import { createPrivateSentryTransport } from "./transport";

afterEach(() => setSystemTime());

test("discard reports aggregate counts and send at most once per minute", () => {
  setSystemTime(1_800_000_000_000);
  const reports = createDiscardReports();
  reports.record();
  reports.record();
  expect(reports.take()?.[1]).toEqual([
    [
      { type: "client_report" },
      {
        timestamp: 1_800_000_000,
        discarded_events: [
          { reason: "sample_rate", category: "error", quantity: 2 },
        ],
      },
    ],
  ]);
  reports.record();
  expect(reports.take()).toBeUndefined();
  setSystemTime(1_800_000_060_000);
  expect(reports.take()?.[1][0]?.[1].discarded_events[0]?.quantity).toBe(1);
  expect(reports.take()).toBeUndefined();
});

test("caller-supplied client reports never pass the transport boundary", async () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  const transport = createPrivateSentryTransport({
    environment: "staging",
    release: "synthetic",
    dist: "staging",
    origin: "",
    scriptPath: "",
    runtime: "api",
  })({
    url: "https://sentry.invalid/envelope",
    recordDroppedEvent: () => {},
  });
  try {
    await transport.send([
      {},
      [
        [
          { type: "client_report" },
          {
            timestamp: Date.now() / 1000,
            discarded_events: [
              { reason: "sample_rate", category: "error", quantity: 1 },
            ],
          },
        ],
      ],
    ]);
    await transport.flush(2000);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});

test("a pending discard report stays inside the caller's flush timeout", async () => {
  const pending = Promise.withResolvers<Response>();
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_url: unknown, init?: RequestInit) =>
        String(init?.body).includes('"type":"client_report"')
          ? pending.promise
          : new Response(null, { status: 200 }),
      { preconnect: () => {} },
    ),
  );
  const transport = createPrivateSentryTransport({
    environment: "staging",
    release: "synthetic",
    dist: "staging",
    origin: "",
    scriptPath: "",
    runtime: "api",
  })({ url: "https://sentry.invalid/envelope", recordDroppedEvent: () => {} });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const event = { tags: { diagnostic_source: "request-error" } };
    const headers = {
      event_id: "a".repeat(32),
      sent_at: new Date().toISOString(),
    };
    await transport.send([headers, [[{ type: "event" }, event]]]);
    await transport.send([headers, [[{ type: "event" }, event]]]);
    const result = await Promise.race([
      transport.flush(10),
      new Promise<string>((resolve) => {
        deadline = setTimeout(() => resolve("exceeded deadline"), 500);
      }),
    ]);
    expect(result).toBe(false);
  } finally {
    clearTimeout(deadline);
    pending.resolve(new Response(null, { status: 200 }));
    await transport.flush(2000);
    fetchSpy.mockRestore();
  }
});
