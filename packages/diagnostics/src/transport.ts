import { makeFetchTransport } from "@sentry/browser";
import type { ClientOptions, Event } from "@sentry/core";
import { createSentryEventBudget } from "./budget";
import { createDiscardReports } from "./discardReports";
import { fetchWithTimeout } from "./fetch";
import { type SentryPrivacyConfig, sanitizeSentryEvent } from "./privacy";

type SentryTransport = ReturnType<ClientOptions["transport"]>;
type SentryItem = Parameters<SentryTransport["send"]>[0][1][number];
function isEventItem(item: SentryItem): item is [{ type: "event" }, Event] {
  return item[0].type === "event";
}

/** Nothing except rebuilt error envelopes can leave this boundary. */
function rebuiltEventItems(
  envelope: Parameters<SentryTransport["send"]>[0],
  config: SentryPrivacyConfig,
  admitEvent: ReturnType<typeof createSentryEventBudget>,
  discards: ReturnType<typeof createDiscardReports> | undefined,
): Array<[{ type: "event" }, Event]> {
  const items: Array<[{ type: "event" }, Event]> = [];
  for (const item of envelope[1]) {
    if (!isEventItem(item)) continue;
    const event = sanitizeSentryEvent(item[1], config);
    if (event && admitEvent(event)) items.push([{ type: "event" }, event]);
    else if (event) discards?.record();
  }
  return items;
}

export function createPrivateSentryTransport(
  config: SentryPrivacyConfig,
): ClientOptions["transport"] {
  return (options) => {
    const admitEvent = createSentryEventBudget(config.budgetResetMs);
    const discards =
      config.runtime === "api" ? createDiscardReports() : undefined;
    const transport = makeFetchTransport(options, (url, init) =>
      fetchWithTimeout(url, {
        ...init,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
    return {
      async flush(timeout) {
        const report = discards?.take();
        // send registers in the transport buffer synchronously. Let flush bound
        // the entire drain rather than waiting for a report before its timeout.
        if (report) void transport.send(report).then(undefined, () => {});
        return transport.flush(timeout);
      },
      send(envelope) {
        const items = rebuiltEventItems(envelope, config, admitEvent, discards);
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
