import { expect, test } from "bun:test";
import { createBodyAdmission } from "./bodyAdmission";
import { expectedRequestBytes, retainUntilDrained } from "./requestBody";

test("small requests use spare capacity while a sync waits, even with a full queue", async () => {
  const admission = createBodyAdmission({ maxPending: 1 });
  const syncBytes = 48 * 1024 * 1024 + 100;
  const first = await admission.acquire(syncBytes);
  const pending = admission.acquire(syncBytes);
  const small = await admission.acquire(1024);
  expect(small).not.toBeNull();
  small?.();
  first?.();
  (await pending)?.();
  expect(admission.inFlight()).toBe(0);
});

test("overlapping tiny syncs wait for the previous response to drain", async () => {
  const admission = createBodyAdmission();
  const path = "/documents/doc-1/sync";
  const bytes = expectedRequestBytes(
    new Request(`https://api.test${path}`, {
      method: "POST",
      headers: { "content-length": "2" },
      body: "{}",
    }),
    path,
    16 * 1024 * 1024,
  );
  const first = await admission.acquire(bytes);
  if (!first) throw new Error("Expected first sync to be admitted");
  const response = retainUntilDrained(Response.json({ updates: [] }), first);
  let started = false;
  const second = admission.acquire(bytes).then((release) => {
    started = true;
    return release;
  });
  await Bun.sleep(0);
  expect(started).toBe(false);
  expect(admission.inFlight()).toBe(bytes);
  await response.text();
  const release = await second;
  expect(release).not.toBeNull();
  expect(admission.inFlight()).toBe(bytes);
  release?.();
  release?.();
  expect(admission.inFlight()).toBe(0);
});

test("waiters reserve in FIFO order without exceeding the budget", async () => {
  const admission = createBodyAdmission({ capacity: 100, maxBypassBytes: 0 });
  const first = await admission.acquire(60);
  const second = await admission.acquire(30);
  const order: number[] = [];
  const third = admission.acquire(80).then((release) => {
    order.push(3);
    return release;
  });
  const fourth = admission.acquire(10).then((release) => {
    order.push(4);
    return release;
  });
  first?.();
  await Bun.sleep(0);
  expect(order).toEqual([]);
  expect(admission.inFlight()).toBe(30);
  second?.();
  const releases = await Promise.all([third, fourth]);
  expect(order).toEqual([3, 4]);
  expect(admission.inFlight()).toBe(90);
  for (const release of releases) release?.();
  expect(admission.inFlight()).toBe(0);
});

test("a full queue refuses excess work but lets zero-byte requests through", async () => {
  const admission = createBodyAdmission({ capacity: 100, maxPending: 1 });
  const first = await admission.acquire(100);
  const pending = admission.acquire(100);
  expect(await admission.acquire(1)).toBeNull();
  const preflight = await admission.acquire(0);
  expect(preflight).not.toBeNull();
  preflight?.();
  expect(admission.inFlight()).toBe(100);
  first?.();
  (await pending)?.();
  expect(admission.inFlight()).toBe(0);
});

test("an impossible reservation never blocks later work", async () => {
  const admission = createBodyAdmission({ capacity: 100 });
  expect(await admission.acquire(101)).toBeNull();
  const release = await admission.acquire(100);
  expect(release).not.toBeNull();
  release?.();
});

test("a canceled queue head frees its slot and wakes the next fitting request", async () => {
  const admission = createBodyAdmission({
    capacity: 100,
    maxPending: 2,
    maxBypassBytes: 0,
  });
  const first = await admission.acquire(60);
  const controller = new AbortController();
  const canceled = admission.acquire(80, controller.signal);
  const next = admission.acquire(30);
  controller.abort();
  expect(await canceled).toBeNull();
  const release = await next;
  expect(release).not.toBeNull();
  expect(admission.inFlight()).toBe(90);
  expect(await admission.acquire(1, controller.signal)).toBeNull();
  first?.();
  release?.();
  expect(admission.inFlight()).toBe(0);
});

test("cancellation racing admission returns the newly reserved bytes", async () => {
  const admission = createBodyAdmission({ capacity: 100 });
  const first = await admission.acquire(100);
  const controller = new AbortController();
  const canceled = admission.acquire(100, controller.signal);
  first?.();
  controller.abort();
  // workerd may discard the canceled request's continuation entirely. The
  // abort listener must return a grant before any await resumes below.
  expect(admission.inFlight()).toBe(0);
  expect(await canceled).toBeNull();
  expect(admission.inFlight()).toBe(0);
});

test("cancellation racing immediate admission returns the reserved bytes", async () => {
  const admission = createBodyAdmission({ capacity: 100 });
  const controller = new AbortController();
  const canceled = admission.acquire(100, controller.signal);
  controller.abort();
  expect(await canceled).toBeNull();
  expect(admission.inFlight()).toBe(0);
});

test("a claimed reservation remains held until its route or stream releases it", async () => {
  const admission = createBodyAdmission({ capacity: 100 });
  const controller = new AbortController();
  const release = await admission.acquire(100, controller.signal);
  controller.abort();
  expect(admission.inFlight()).toBe(100);
  release?.();
  expect(admission.inFlight()).toBe(0);
});

test("a timed-out waiter is removed and does not take capacity later", async () => {
  const admission = createBodyAdmission({
    capacity: 100,
    maxPending: 1,
    maxWaitMs: 10,
  });
  const first = await admission.acquire(100);
  expect(await admission.acquire(100)).toBeNull();
  const next = admission.acquire(100);
  first?.();
  const release = await next;
  expect(release).not.toBeNull();
  release?.();
  expect(admission.inFlight()).toBe(0);
});

test("response cancellation and read failures wake waiting requests", async () => {
  for (const failure of ["cancel", "error"] as const) {
    const admission = createBodyAdmission({ capacity: 100 });
    const release = await admission.acquire(100);
    if (!release) throw new Error("Expected reservation");
    const response = retainUntilDrained(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (failure === "error") controller.error(new Error("read failed"));
          },
        }),
      ),
      release,
    );
    const next = admission.acquire(100);
    if (failure === "cancel") await response.body?.cancel();
    else await expect(response.text()).rejects.toThrow("read failed");
    const nextRelease = await next;
    expect(nextRelease).not.toBeNull();
    nextRelease?.();
    expect(admission.inFlight()).toBe(0);
  }
});
