import { expect, test } from "bun:test";
import { createRedisPubSub, type PubSubClient } from "./redisPubSub";

/** A client whose connect fires `ready` and whose subscribe is held open. */
function fakeClient() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const subscribed = Promise.withResolvers<void>();
  const client = {
    isOpen: false,
    async connect() {
      client.isOpen = true;
      for (const handler of handlers.get("ready") ?? []) handler();
    },
    async close() {
      client.isOpen = false;
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), listener]);
    },
    async publish() {},
    async subscribe() {
      await subscribed.promise;
    },
    ready() {
      for (const handler of handlers.get("ready") ?? []) handler();
    },
  };
  return { client: client as PubSubClient & typeof client, subscribed };
}

test("the first held subscription counts as a reconnect for sockets already open", async () => {
  const fake = fakeClient();
  const pubSub = createRedisPubSub({
    createClient: () => fake.client,
    inMemory: () => false,
  });
  let reconnects = 0;
  pubSub.addSubscriberReconnectListener(() => {
    reconnects++;
  });
  // The gateway starts listening (sockets may open right away) while the
  // connect-time `ready` has fired but the channel subscription is pending.
  pubSub.addListener(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fake.client.isOpen).toBe(true);
  expect(reconnects).toBe(0);

  fake.subscribed.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Hints published before the subscription held are gone: catch up once.
  expect(reconnects).toBe(1);

  // A dropped connection re-subscribes on its own; its `ready` marks the gap.
  fake.client.ready();
  expect(reconnects).toBe(2);
  await pubSub.close();
});
