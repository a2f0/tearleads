import type { Event, StackParser } from "@sentry/core";
import { type SentryPrivacyConfig, sanitizeSentryEvent } from "./privacy";

const REPORTER_FRAME =
  /(?:^|\/)packages\/(?:diagnostics\/src\/server|api\/src\/diagnostics\/(?:sentry|reportBackgroundFailure))\.ts$/u;

export function sanitizeServerEvent(
  event: Event,
  config: SentryPrivacyConfig,
  parseStack: StackParser,
  captureSite?: Error | null,
) {
  if (config.runtime !== "api") return sanitizeSentryEvent(event, config);
  const original = sanitizeSentryEvent(
    {
      ...event,
      tags: { ...event.tags, api_stack: "original" },
    },
    config,
  );
  if (!original || original.exception?.values?.[0]?.stacktrace?.frames?.length)
    return original;

  // Async driver/network errors often contain only third-party/runtime frames.
  // Preserve where our application caught them, explicitly marked as a capture
  // site rather than pretending it is the throw site. Apply the same path rules.
  const frames = parseStack(captureSite?.stack ?? "").filter(
    (frame) => !REPORTER_FRAME.test(frame.filename ?? ""),
  );
  const fallback = sanitizeSentryEvent(
    {
      ...event,
      tags: { ...event.tags, api_stack: "capture-site" },
      exception: {
        values: [{ ...event.exception?.values?.[0], stacktrace: { frames } }],
      },
    },
    config,
  );
  if (fallback?.exception?.values?.[0]?.stacktrace?.frames?.length)
    return fallback;
  return { ...original, tags: { ...original.tags, api_stack: "unavailable" } };
}
