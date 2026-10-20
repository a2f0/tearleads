import type { PublishedRealtimeEvent } from "../realtime/publishedRealtimeEvents";
import { workerRealtimePublisher } from "../worker/environment";

type EventListener = (message: string) => void;

// The local Bun server runs the HTTP app and the realtime gateway in one
// process, so its bus is this listener set.
const listeners = new Set<EventListener>();

function publishInProcess(event: PublishedRealtimeEvent): void {
  const message = JSON.stringify(event);
  for (const listener of listeners) {
    try {
      listener(message);
    } catch (error) {
      console.error("Realtime listener error:", error);
    }
  }
}

// On Workers the realtime hub Durable Object is the bus: HTTP isolates publish
// to it over RPC, and inside it the call is local.
export const publish = async (event: PublishedRealtimeEvent): Promise<void> => {
  const publishToHub = workerRealtimePublisher();
  if (publishToHub) {
    await publishToHub(JSON.stringify(event));
    return;
  }
  publishInProcess(event);
};

export const addListener = (listener: EventListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Observe the bus resuming after a gap in which published hints were lost. The
 * in-process bus never drops a hint, so it never fires.
 */
export const addSubscriberReconnectListener = (
  _listener: () => void,
): (() => void) => {
  return () => {};
};

/** Drop every listener; tests reset between files. */
export const resetPubSub = (): void => {
  listeners.clear();
};
