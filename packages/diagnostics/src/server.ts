import {
  createStackParser,
  nodeStackLineParser,
  Scope,
  ServerRuntimeClient,
} from "@sentry/core";
import { apiErrorTags } from "./apiDiagnostics";
import type { ApiDiagnosticOperation } from "./apiVocabulary";
import type { SentryConfig } from "./config";
import { sanitizeServerEvent } from "./serverEvent";
import { createPrivateSentryTransport } from "./transport";

export type { ApiDiagnosticOperation } from "./apiVocabulary";

// `background-error` covers post-commit and post-handshake failures the API
// logged and swallowed: they produce no HTTP error response, so tagging them as
// request failures would dilute the 5xx signal.
export type ServerErrorSource =
  | "background-error"
  | "request-error"
  | "websocket-error";

// Admitted only for runtime electrobun-main; the sanitizer drops any source
// foreign to the configured runtime.
export type MainProcessErrorSource =
  | "background-error"
  | "request-error"
  | "unhandled-error"
  | "unhandled-rejection";

export function createServerDiagnostics(config: SentryConfig) {
  const stackParser = createStackParser(nodeStackLineParser());
  const client = new ServerRuntimeClient({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    dist: config.dist,
    stackParser,
    // The transport sanitizes again, after beforeSend has rebuilt every frame
    // under app:///. Only that second pass takes app:// as its root, so a raw
    // app:/// frame never passes a runtime that requires its absolute root.
    transport: createPrivateSentryTransport({
      ...config,
      serverSourceRoot: "app://",
    }),
    integrations: [],
    sendDefaultPii: false,
    sendClientReports: false,
    enableLogs: false,
    maxBreadcrumbs: 0,
    beforeSend: (event, hint) =>
      sanitizeServerEvent(event, config, stackParser, hint.syntheticException),
  });
  client.init();
  return {
    captureError(
      error: unknown,
      source: ServerErrorSource | MainProcessErrorSource,
      operation?: ApiDiagnosticOperation,
    ) {
      if (!(error instanceof Error)) return;
      // Each error has an isolated scope. No request or user context is shared.
      const scope = new Scope();
      scope.setClient(client);
      scope.captureException(error, {
        ...(config.runtime === "api"
          ? { syntheticException: new Error() }
          : {}),
        captureContext: {
          tags: {
            diagnostic_source: source,
            ...(config.runtime === "api" ? apiErrorTags(error, operation) : {}),
          },
        },
      });
    },
    flush: () => client.flush(2000),
    close: () => client.close(2000),
  };
}
