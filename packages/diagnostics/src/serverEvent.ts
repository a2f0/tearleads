import type { Event, StackParser } from "@sentry/core";
import { diagnosticErrorChain, errorDataProperty } from "./errorProperties";
import { type SentryPrivacyConfig, sanitizeSentryEvent } from "./privacy";

const REPORTER_FRAME =
  /(?:^|\/)packages\/(?:diagnostics\/src\/server|api\/src\/diagnostics\/(?:sentry|reportBackgroundFailure))\.ts$/u;

export function sanitizeServerEvent(
  event: Event,
  config: SentryPrivacyConfig,
  parseStack: StackParser,
  captureSite?: Error | null,
  originalError?: unknown,
) {
  if (config.runtime !== "api") return sanitizeSentryEvent(event, config);
  const chain = diagnosticErrorChain(originalError);
  if (chain.length > 1) {
    const root = event.exception?.values?.[0] ?? {};
    event = {
      ...event,
      exception: {
        // Sentry orders causes before their enclosing exception.
        values: chain
          .map((error, index) => {
            if (index === 0) return root;
            const stack = errorDataProperty(error, "stack");
            const name =
              errorDataProperty(error, "name") ??
              errorDataProperty(Object.getPrototypeOf(error), "name");
            return {
              type: typeof name === "string" ? name : "Error",
              stacktrace: {
                frames: parseStack(typeof stack === "string" ? stack : ""),
              },
            };
          })
          .reverse(),
      },
    };
  }
  const original = sanitizeSentryEvent(
    {
      ...event,
      tags: { ...event.tags, api_stack: "original" },
    },
    config,
  );
  if (
    !original ||
    original.exception?.values?.some(
      (value) => value.stacktrace?.frames?.length,
    )
  )
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
        values: [
          { ...event.exception?.values?.at(-1), stacktrace: { frames } },
        ],
      },
    },
    config,
  );
  if (fallback?.exception?.values?.[0]?.stacktrace?.frames?.length)
    return fallback;
  return { ...original, tags: { ...original.tags, api_stack: "unavailable" } };
}
