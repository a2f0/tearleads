import {
  createStackParser,
  nodeStackLineParser,
  Scope,
  ServerRuntimeClient,
} from "@sentry/core";
import type { SentryConfig } from "./config";
import { sanitizeSentryEvent } from "./privacy";
import { createPrivateSentryTransport } from "./transport";

// `background-error` covers post-commit and post-handshake failures the API
// logged and swallowed: they produce no HTTP error response, so tagging them as
// request failures would dilute the 5xx signal.
export type ServerErrorSource =
  | "background-error"
  | "request-error"
  | "websocket-error";

export function createServerDiagnostics(config: SentryConfig) {
  const client = new ServerRuntimeClient({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    dist: config.dist,
    stackParser: createStackParser(nodeStackLineParser()),
    transport: createPrivateSentryTransport(config),
    integrations: [],
    sendDefaultPii: false,
    sendClientReports: false,
    enableLogs: false,
    maxBreadcrumbs: 0,
    beforeSend: (event) => sanitizeSentryEvent(event, config),
  });
  client.init();
  return {
    captureError(error: unknown, source: ServerErrorSource) {
      if (!(error instanceof Error)) return;
      // Each error has an isolated scope. No request or user context is shared.
      const scope = new Scope();
      scope.setClient(client);
      scope.captureException(error, {
        captureContext: { tags: { diagnostic_source: source } },
      });
    },
    flush: () => client.flush(2000),
    close: () => client.close(2000),
  };
}
