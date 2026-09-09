import { type ClientOptions, createTransport, type Event } from "@sentry/core";
import { createSentryEventBudget } from "./budget";
import { type SentryPrivacyConfig, sanitizeSentryEvent } from "./privacy";

type SentryTransport = ReturnType<ClientOptions["transport"]>;
type SentryItem = Parameters<SentryTransport["send"]>[0][1][number];
function isEventItem(item: SentryItem): item is [{ type: "event" }, Event] {
  return item[0].type === "event";
}

export function createPrivateSentryTransport(
  config: SentryPrivacyConfig,
): ClientOptions["transport"] {
  return (options) => {
    const admitEvent = createSentryEventBudget(config.budgetResetMs);
    const transport = createTransport(options, async ({ body }) => {
      const response = await fetch(options.url, {
        method: "POST",
        body: typeof body === "string" ? body : new Uint8Array(body),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(5000),
      });
      return {
        statusCode: response.status,
        headers: {
          "x-sentry-rate-limits": response.headers.get("X-Sentry-Rate-Limits"),
          "retry-after": response.headers.get("Retry-After"),
        },
      };
    });
    return {
      flush: (timeout) => transport.flush(timeout),
      send(envelope) {
        // Nothing except rebuilt error envelopes can leave this boundary.
        const items: Array<[{ type: "event" }, Event]> = [];
        for (const item of envelope[1]) {
          if (!isEventItem(item)) continue;
          const event = sanitizeSentryEvent(item[1], config);
          if (event && admitEvent(event))
            items.push([{ type: "event" }, event]);
        }
        return items.length
          ? transport.send([
              {
                event_id:
                  items[0]?.[1].event_id ??
                  crypto.randomUUID().replaceAll("-", ""),
                sent_at: new Date().toISOString(),
              },
              items,
            ])
          : Promise.resolve({});
      },
    };
  };
}
