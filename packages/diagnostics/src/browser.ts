import { BrowserClient, defaultStackParser, Scope } from "@sentry/browser";
import {
  type AppDiagnostics,
  isDiagnosticAction,
  isDiagnosticArea,
} from "./activity";
import type { SentryConfig } from "./config";
import { sanitizeSentryEvent } from "./privacy";
import { createPrivateSentryTransport } from "./transport";

export interface WebDiagnostics extends AppDiagnostics {
  flush: () => PromiseLike<boolean>;
  dispose: () => PromiseLike<boolean>;
}

export function createBrowserDiagnostics(config: SentryConfig): WebDiagnostics {
  const client = new BrowserClient({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    dist: config.dist,
    stackParser: defaultStackParser,
    transport: createPrivateSentryTransport(config),
    // A private client/scope with no SDK integrations means no automatic DOM,
    // console, network, URL, user, session, performance, or replay collection.
    integrations: [],
    // Sentry 11 collects these categories by default. Disable them before
    // the event and transport allowlists enforce the application policy.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    sendClientReports: false,
    maxBreadcrumbs: 30,
    beforeSend: (event) => sanitizeSentryEvent(event, config),
  });
  const scope = new Scope();
  scope.setClient(client);
  client.init();
  const diagnostics: WebDiagnostics = {
    clearBreadcrumbs: () => scope.clearBreadcrumbs(),
    addBreadcrumb(breadcrumb) {
      if (
        !isDiagnosticArea(breadcrumb.area) ||
        !isDiagnosticAction(breadcrumb.action)
      )
        return;
      scope.addBreadcrumb(
        {
          category: "app.activity",
          data: { area: breadcrumb.area, action: breadcrumb.action },
        },
        30,
      );
    },
    captureError(error, context) {
      const tags = { area: context.area, diagnostic_source: context.source };
      if (error instanceof Error) {
        scope.captureException(error, { captureContext: { tags } });
      } else if (context.source === "boundary") {
        scope.captureEvent({
          tags,
          exception: {
            values: [
              { type: "Error", value: "Application error (message omitted)" },
            ],
          },
        });
      }
    },
    setApiVersion: (version) => scope.setTag("api_version", String(version)),
    flush: () => client.flush(2000),
    dispose() {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("pagehide", onPageHide);
      return client.close(2000);
    },
  };
  const onError = (event: ErrorEvent) =>
    diagnostics.captureError(event.error, {
      area: "app",
      source: "unhandled-error",
    });
  const onRejection = (event: PromiseRejectionEvent) =>
    diagnostics.captureError(event.reason, {
      area: "app",
      source: "unhandled-rejection",
    });
  const onPageHide = () => {
    void Promise.resolve(client.flush(2000)).catch(() => undefined);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("pagehide", onPageHide);
  return diagnostics;
}
