import { makeFetchTransport } from "@sentry/browser";
import type { ClientOptions, Event } from "@sentry/core";
import { createSentryEventBudget } from "./budget";
import { fetchWithTimeout } from "./fetch";
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
    const transport = makeFetchTransport(options, (url, init) =>
      fetchWithTimeout(url, {
        ...init,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
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
