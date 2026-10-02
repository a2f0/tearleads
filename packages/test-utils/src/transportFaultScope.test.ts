import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTransportFaultHarness } from "./createTransportFaultHarness";
import { createTransportGate } from "./createTransportGate";

const url = "https://api.test/";
const responseStep = {
  name: "health",
  method: "GET",
  url,
  action: {
    kind: "response",
    response: () => Response.json({ message: "ok" }),
  },
} as const;

test("unused steps and unexpected requests fail even when a client swallows errors", async () => {
  const unused = createTransportFaultHarness({ steps: [responseStep] });
  await expect(unused.run(() => undefined)).rejects.toThrow("1 unused steps");
  const mismatch = createTransportFaultHarness({
    steps: [{ ...responseStep, method: "POST" }],
  });
  await expect(
    mismatch.run(async () => {
      const client = new ApiClient("https://api.test");
      client.setOnError(() => {});
      expect(await client.getHealth()).toBeNull();
    }),
  ).rejects.toThrow("unexpected");
  const extra = createTransportFaultHarness({ steps: [] });
  await expect(
    extra.run(async () => {
      await fetch(url).catch(() => undefined);
    }),
  ).rejects.toThrow("unexpected");
});

test("request scripts match the complete URL including origin and query", async () => {
  for (const requestUrl of ["https://another.test/", `${url}?extra=true`]) {
    const harness = createTransportFaultHarness({ steps: [responseStep] });
    await expect(harness.fetch(requestUrl)).rejects.toThrow("Unexpected GET");
    expect(harness.attempts[0]?.outcome).toBe("unexpected");
    expect(() => harness.assertComplete()).toThrow("1 unused steps");
  }
});

test("swallowed request construction errors remain unexpected attempts", async () => {
  for (const [resource, init] of [
    ["invalid-url", undefined],
    [url, { method: "GET", body: "invalid GET body" }],
  ] as const) {
    const harness = createTransportFaultHarness({ steps: [] });
    await expect(
      harness.run(async () => {
        await fetch(resource, init).catch(() => undefined);
      }),
    ).rejects.toThrow("unexpected");
    expect(harness.attempts).toHaveLength(1);
    expect(harness.attempts[0]?.outcome).toBe("unexpected");
    expect(harness.attempts[0]?.error).not.toBeNull();
  }
});

test("aborting before a planned fault cannot satisfy the script", async () => {
  const harness = createTransportFaultHarness({
    steps: [{ ...responseStep, action: { kind: "network-error" } }],
  });
  await expect(
    harness.fetch(url, {
      signal: AbortSignal.abort(new Error("cancelled before fault")),
    }),
  ).rejects.toThrow("cancelled before fault");
  expect(() => harness.assertComplete()).toThrow("aborted");
  const expectedAbort = createTransportFaultHarness({
    steps: [{ ...responseStep, expectedOutcome: "aborted" }],
  });
  await expectedAbort.fetch(url);
  expect(() => expectedAbort.assertComplete()).toThrow("response");
});

test("global fetch is restored after success, callback failure, and incomplete scripts", async () => {
  const original = globalThis.fetch;
  const success = createTransportFaultHarness({ steps: [responseStep] });
  expect(await success.run(async () => (await fetch(url)).status)).toBe(200);
  expect(globalThis.fetch).toBe(original);
  const failure = createTransportFaultHarness({ steps: [] });
  await expect(
    failure.run(() => {
      throw new Error("test failure");
    }),
  ).rejects.toThrow("test failure");
  expect(globalThis.fetch).toBe(original);
  const incomplete = createTransportFaultHarness({ steps: [responseStep] });
  await expect(incomplete.run(() => undefined)).rejects.toThrow("unused");
  expect(globalThis.fetch).toBe(original);
});

test("overlapping global scopes reject without replacing the active fetch", async () => {
  const first = createTransportFaultHarness({ steps: [] });
  const second = createTransportFaultHarness({ steps: [] });
  await first.run(async () => {
    await expect(second.run(() => undefined)).rejects.toThrow("serially");
    expect(globalThis.fetch).toBe(first.fetch);
  });
  await second.run(() => undefined);
});

test("scope cleanup aborts unawaited gates and refuses a pending success", async () => {
  const original = globalThis.fetch;
  const gate = createTransportGate();
  const harness = createTransportFaultHarness({
    steps: [{ ...responseStep, gate }],
  });
  let rejection: Promise<unknown> | undefined;
  await expect(
    harness.run(async () => {
      rejection = fetch(url).catch((error: unknown) => error);
      await gate.entered;
    }),
  ).rejects.toThrow("pending");
  expect(globalThis.fetch).toBe(original);
  expect(await rejection).toBeInstanceOf(DOMException);
  expect(harness.attempts[0]?.outcome).toBe("aborted");
});

test("missing or failing delegates cannot masquerade as scripted faults", async () => {
  for (const delegate of [
    undefined,
    () => {
      throw new Error("broken server");
    },
  ]) {
    const harness = createTransportFaultHarness({
      steps: [{ ...responseStep, action: { kind: "forward" } }],
      ...(delegate ? { delegate } : {}),
    });
    await expect(harness.fetch(url)).rejects.toThrow();
    expect(harness.attempts[0]?.outcome).toBe("delegate-error");
    expect(() => harness.assertComplete()).toThrow("delegate-error");
  }
});

test("the real API client classifies offline and HTTP faults then recovers", async () => {
  const client = new ApiClient("https://api.test");
  const connectivity: boolean[] = [];
  client.setOnError(() => {});
  client.setOnNetworkError(() => connectivity.push(false));
  client.setOnNetworkSuccess(() => connectivity.push(true));
  const harness = createTransportFaultHarness({
    steps: [
      { ...responseStep, name: "offline", action: { kind: "network-error" } },
      {
        ...responseStep,
        name: "unavailable",
        action: {
          kind: "response",
          response: () =>
            Response.json({ error: "Unavailable" }, { status: 503 }),
        },
      },
      responseStep,
    ],
  });
  await harness.run(async () => {
    expect(await client.getHealth()).toBeNull();
    expect(client.getRequestFailure({ method: "GET", path: "/" })?.kind).toBe(
      "network",
    );
    expect(await client.getHealth()).toBeNull();
    expect(
      client.getRequestFailure({ method: "GET", path: "/" }),
    ).toMatchObject({ kind: "http", status: 503 });
    expect(await client.getHealth()).toEqual({ message: "ok" });
  });
  expect(connectivity).toEqual([false, true, true]);
});
