import { expect, mock, test } from "bun:test";

mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected readonly ctx: unknown,
      protected readonly env: unknown,
    ) {}
  },
}));
const { RealtimeHub } = await import("./realtimeHubObject");

test("a routed publication does not await an unrelated revalidation read", async () => {
  const checks = Promise.withResolvers<void>();
  const routed = Promise.withResolvers<void>();
  const background: Promise<unknown>[] = [];
  const hub: InstanceType<typeof RealtimeHub> = Object.assign(
    Object.create(RealtimeHub.prototype),
    {
      ctx: {
        waitUntil: (pending: Promise<unknown>) => background.push(pending),
      },
      scheduler: {
        enter: () => () => {},
        runDue: () => checks.promise,
        flush: async () => {},
      },
      hub: Promise.resolve({
        withDatabase: (work: () => Promise<void>) => work(),
        report: () => {},
        gateway: {
          publish: async () => {
            routed.resolve();
          },
          flush: async () => {},
        },
        connections: { saveDirty: () => {} },
      }),
    },
  );
  const publication = hub.publish("{}");
  try {
    await routed.promise;
    const result = await Promise.race([
      publication.then(() => "acknowledged"),
      Bun.sleep(0).then(() => "blocked"),
    ]);
    expect(result).toBe("acknowledged");
  } finally {
    checks.resolve();
    await publication;
    await Promise.all(background);
  }
});

test("failed checks and interest writes still save sockets and schedule the next alarm", async () => {
  const steps: string[] = [];
  const hub: InstanceType<typeof RealtimeHub> = Object.assign(
    Object.create(RealtimeHub.prototype),
    {
      ctx: { waitUntil: () => {} },
      scheduler: {
        enter: () => () => {
          steps.push("leave");
        },
        runDue: async () => {
          throw new Error("check failed");
        },
        flush: async () => {
          steps.push("alarm");
        },
      },
      hub: Promise.resolve({
        withDatabase: async (work: () => Promise<void>) => {
          try {
            await work();
          } finally {
            steps.push("database closed");
          }
        },
        gateway: {
          flush: async () => {
            steps.push("interest");
            throw new Error("write failed");
          },
        },
        connections: {
          saveDirty: () => {
            steps.push("snapshots");
          },
        },
      }),
    },
  );
  await expect(hub.alarm()).rejects.toThrow("Realtime event failed");
  expect(steps).toEqual([
    "interest",
    "snapshots",
    "alarm",
    "database closed",
    "leave",
  ]);
});

test("a failed restoration can retry on the next event", async () => {
  let attempts = 0;
  const loaded = {
    withDatabase: (work: () => Promise<void>) => work(),
    gateway: { flush: async () => {} },
    connections: { saveDirty: () => {} },
  };
  const hub: InstanceType<typeof RealtimeHub> = Object.assign(
    Object.create(RealtimeHub.prototype),
    {
      ctx: { waitUntil: () => {} },
      scheduler: {
        enter: () => () => {},
        runDue: async () => {},
        flush: async () => {},
      },
      restore: async () => {
        if (++attempts === 1) throw new Error("restore failed");
        return loaded;
      },
    },
  );
  await expect(hub.alarm()).rejects.toThrow("restore failed");
  await hub.alarm();
  expect(attempts).toBe(2);
});
