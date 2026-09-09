import {
  type BrowserOptions,
  type Event,
  makeFetchTransport,
} from "@sentry/browser";
import { createSentryEventBudget } from "./sentryBudget";
import { type SentryPrivacyConfig, sanitizeSentryEvent } from "./sentryPrivacy";

type SentryTransport = ReturnType<NonNullable<BrowserOptions["transport"]>>;
type SentryItem = Parameters<SentryTransport["send"]>[0][1][number];

function isEventItem(item: SentryItem): item is [{ type: "event" }, Event] {
  return item[0].type === "event";
}

export function createPrivateSentryTransport(
  config: SentryPrivacyConfig,
): NonNullable<BrowserOptions["transport"]> {
  return (options) => {
    const admitEvent = createSentryEventBudget();
    const transport = makeFetchTransport({
      ...options,
      fetchOptions: { credentials: "omit", referrerPolicy: "no-referrer" },
    });
    return {
      flush: (timeout) => transport.flush(timeout),
      send(envelope) {
        // This final boundary also rejects attachments, sessions, logs, replay,
        // profiles, transactions, client reports, and SDK envelope metadata.
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
