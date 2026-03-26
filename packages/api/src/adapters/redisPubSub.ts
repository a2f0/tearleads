import { createClient } from "redis";

const CHANNEL = "events";

const publisher = createClient();
const subscriber = createClient();

publisher.on("error", (err) => {
  console.error("Redis publisher error:", err);
});

subscriber.on("error", (err) => {
  console.error("Redis subscriber error:", err);
});

await publisher.connect();
await subscriber.connect();

type EventListener = (message: string) => void;

const listeners = new Set<EventListener>();

await subscriber.subscribe(CHANNEL, (message) => {
  for (const listener of listeners) {
    listener(message);
  }
});

export async function publish(event: Record<string, unknown>): Promise<void> {
  await publisher.publish(CHANNEL, JSON.stringify(event));
}

export function addListener(listener: EventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
