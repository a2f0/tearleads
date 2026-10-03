import { expect, test } from "bun:test";
import { createTransportFaultHarness } from "./createTransportFaultHarness";
import { createTransportGate } from "./createTransportGate";

const url = "https://api.test/documents/example/sync";

test("offline failures skip the delegate; lost responses run it before failing", async () => {
  const commits: string[] = [];
  const harness = createTransportFaultHarness({
    steps: [
      {
        name: "offline",
        method: "POST",
        url,
        action: { kind: "network-error" },
      },
      { name: "lost", method: "POST", url, action: { kind: "lost-response" } },
      { name: "retry", method: "POST", url, action: { kind: "forward" } },
    ],
    delegate: async (request) => {
      expect(request.headers.get("x-test")).toBe("retained");
      commits.push(await request.text());
      return Response.json({ accepted: true }, { status: 201 });
    },
  });
  await harness.run(async () => {
    const send = () =>
      fetch(
        new Request(url, {
          method: "POST",
          body: "same-update",
          headers: { "x-test": "retained" },
        }),
      );
    await expect(send()).rejects.toThrow("Scripted network failure");
    expect(commits).toEqual([]);
    await expect(send()).rejects.toThrow("Scripted response loss");
    expect(commits).toEqual(["same-update"]);
    const response = await send();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ accepted: true });
  });
  expect(commits).toEqual(["same-update", "same-update"]);
  expect(
    harness.attempts.map(({ outcome, status }) => ({ outcome, status })),
  ).toEqual([
    { outcome: "network-error", status: null },
    { outcome: "lost-response", status: 201 },
    { outcome: "response", status: 201 },
  ]);
});

test("gates release concurrent requests in a chosen order without sleeps", async () => {
  const firstGate = createTransportGate();
  const secondGate = createTransportGate();
  const completed: number[] = [];
  const harness = createTransportFaultHarness({
    steps: [firstGate, secondGate].map((gate, index) => ({
      name: `request-${index}`,
      method: "GET",
      url,
      gate,
      action: { kind: "response", response: () => Response.json(index) },
    })),
  });
  await harness.run(async () => {
    const receive = async () => {
      const response = await fetch(url);
      completed.push(await response.json());
    };
    const first = receive();
    await firstGate.entered;
    const second = receive();
    await secondGate.entered;
    expect(() => harness.assertComplete()).toThrow("pending");
    secondGate.release();
    await second;
    expect(completed).toEqual([1]);
    firstGate.release();
    await first;
  });
  expect(completed).toEqual([1, 0]);
  expect(harness.attempts.map((attempt) => attempt.sequence)).toEqual([1, 2]);
});

test("losing a response cancels its unread body", async () => {
  let cancelled = false;
  const harness = createTransportFaultHarness({
    steps: [
      { name: "lost", method: "GET", url, action: { kind: "lost-response" } },
    ],
    delegate: () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await expect(harness.fetch(url)).rejects.toThrow("Scripted response loss");
  expect(cancelled).toBe(true);
  harness.assertComplete();
});

test("aborting a paused request prevents forwarding and records the abort", async () => {
  const gate = createTransportGate();
  const controller = new AbortController();
  let forwards = 0;
  const harness = createTransportFaultHarness({
    steps: [
      {
        name: "cancelled",
        method: "GET",
        url,
        gate,
        expectedOutcome: "aborted",
        action: { kind: "forward" },
      },
    ],
    delegate: () => {
      forwards += 1;
      return new Response();
    },
  });
  await harness.run(async () => {
    const pending = fetch(url, { signal: controller.signal });
    const rejection = pending.catch((error: unknown) => error);
    await gate.entered;
    controller.abort(new Error("cancelled by test"));
    expect(await rejection).toEqual(new Error("cancelled by test"));
  });
  expect(forwards).toBe(0);
  expect(harness.attempts[0]?.outcome).toBe("aborted");
});

test("response loss settles while another cloned body branch remains unread", async () => {
  const source = new Response(new ReadableStream());
  const harness = createTransportFaultHarness({
    steps: [
      {
        name: "cloned loss",
        method: "GET",
        url,
        action: { kind: "lost-response" },
      },
    ],
    delegate: () => source.clone(),
  });
  try {
    await expect(harness.fetch(url)).rejects.toThrow("Scripted response loss");
    harness.assertComplete();
  } finally {
    await source.body?.cancel();
  }
});

test("pre-aborted requests do not run a scripted response or delegate", async () => {
  let responses = 0;
  const harness = createTransportFaultHarness({
    steps: [
      {
        name: "cancelled",
        method: "GET",
        url,
        expectedOutcome: "aborted",
        action: {
          kind: "response",
          response: () => {
            responses += 1;
            return new Response();
          },
        },
      },
    ],
  });
  await expect(
    harness.fetch(url, {
      signal: AbortSignal.abort(new Error("already aborted")),
    }),
  ).rejects.toThrow("already aborted");
  expect(responses).toBe(0);
  expect(harness.attempts[0]?.outcome).toBe("aborted");
  harness.assertComplete();
});
