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
