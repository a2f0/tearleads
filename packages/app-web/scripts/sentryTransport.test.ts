import {
  afterAll,
  afterEach,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import type { Event } from "@sentry/browser";
import type { SentryPrivacyConfig } from "@tearleads/diagnostics/privacy";
import { createPrivateSentryTransport } from "@tearleads/diagnostics/transport";

type Transport = ReturnType<ReturnType<typeof createPrivateSentryTransport>>;
type Envelope = Parameters<Transport["send"]>[0];
const secret = "SYNTHETIC_PRIVATE_DOCUMENT_CONTENT";
const config: SentryPrivacyConfig = {
  origin: "https://app.tearleads.com",
  scriptPath: "/chunk-test.js",
  environment: "production",
  release: `tearleads-web@${"a".repeat(40)}`,
  dist: "production-app",
};
const requests: RequestInit[] = [];
const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
  Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      requests.push(args[1] ?? {});
      return new Response(null, { status: 200 });
    },
    { preconnect: () => {} },
  ),
);

afterEach(() => {
  requests.length = 0;
  setSystemTime();
});

function transport(): Transport {
  return createPrivateSentryTransport(config)({
    url: "https://sentry.invalid/envelope",
    recordDroppedEvent: () => {},
  });
}

function event(line = 1, message = secret): Event {
  return {
    event_id: "b".repeat(32),
    tags: { area: "explorer", diagnostic_source: "boundary" },
    extra: { secret },
    request: { url: `${config.origin}/${secret}` },
    exception: {
      values: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            frames: [
              {
                filename: `${config.origin}${config.scriptPath}`,
                lineno: line,
              },
            ],
          },
        },
      ],
    },
  };
}

test("the transport rejects every non-error item and reconstructs envelope metadata", async () => {
  const client = transport();
  const excluded = [
    "attachment",
    "session",
    "sessions",
    "replay_event",
    "replay_recording",
    "profile",
    "transaction",
    "client_report",
    "log",
    "feedback",
    "future_telemetry",
  ];
  // Deliberately adversarial envelope bypasses beforeSend and includes future
  // item types; the transport must independently fail closed.
  const envelope = [
    { event_id: secret, sdk: { name: secret }, trace: { secret } },
    [
      ...excluded.map((type) => [{ type, filename: secret }, secret]),
      [{ type: "event", filename: secret }, event()],
      [{ type: "event" }, { ...event(), type: "transaction" }],
    ],
  ] as unknown as Envelope;
  await client.send(envelope);
  await client.flush(2000);
  expect(requests).toHaveLength(1);
  const request = requests[0];
  expect(request?.credentials).toBe("omit");
  expect(request?.keepalive).toBe(true);
  expect(request?.referrerPolicy).toBe("no-referrer");
  const body = String(request?.body);
  expect(body).not.toContain(secret);
  const lines = body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(lines).toHaveLength(3);
  expect(Object.keys(lines[0]).sort()).toEqual(["event_id", "sent_at"]);
  expect(lines[1]).toEqual({ type: "event" });
  expect(lines[2].exception.values[0].value).toBe(
    "Application error (message omitted)",
  );
  expect(lines[2].extra).toBeUndefined();
  expect(lines[2].request).toBeUndefined();
  const excludedEnvelope = structuredClone(envelope);
  excludedEnvelope[1].splice(excluded.length);
  await client.send(excludedEnvelope);
  expect(requests).toHaveLength(1);
});

test("retry loops cannot bypass deduplication, minute limits, or the page lifetime budget", async () => {
  const start = new Date("2026-01-01T00:00:00Z").getTime();
  setSystemTime(start);
  const client = transport();
  const send = (line: number, message?: string) =>
    client.send([
      { event_id: "b".repeat(32), sent_at: new Date().toISOString() },
      [[{ type: "event" }, event(line, message)]],
    ]);
  await send(1);
  await send(1, "another private message");
  expect(requests).toHaveLength(1);
  for (let line = 2; line <= 10; line++) await send(line);
  expect(requests).toHaveLength(5);
  for (let minute = 1; minute <= 3; minute++) {
    setSystemTime(start + minute * 60_000);
    for (let line = minute * 5 + 1; line <= minute * 5 + 5; line++)
      await send(line);
    expect(requests).toHaveLength((minute + 1) * 5);
  }
  setSystemTime(start + 240_000);
  await send(1);
  await send(21);
  await client.flush(2000);
  expect(requests).toHaveLength(20);
});

// Restore the actual fetch only after this file, so no test can contact Sentry.
afterAll(() => fetchSpy.mockRestore());
