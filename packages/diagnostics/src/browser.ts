import { BrowserClient, defaultStackParser, Scope } from "@sentry/browser";
import {
  type AppDiagnostics,
  isDiagnosticAction,
  isDiagnosticArea,
} from "./activity";
import {
  apiNetworkFailureMessage,
  createApiNetworkFailureReporter,
} from "./apiNetworkFailure";
import { privateDataCollection } from "./collectionPolicy";
import type { SentryConfig } from "./config";
import { sanitizeSentryEvent } from "./privacy";
import { createPrivateSentryTransport } from "./transport";

export interface WebDiagnostics extends AppDiagnostics {
  flush: () => PromiseLike<boolean>;
  dispose: () => PromiseLike<boolean>;
}

// The first failure of a class is an event; the rest are breadcrumbs.
function apiNetworkFailureReporter(scope: Scope, config: SentryConfig) {
  return createApiNetworkFailureReporter(
    {
      captureEvent: (tags) =>
        scope.captureEvent({
          level: "warning",
          tags: { area: "app", diagnostic_source: "api-network", ...tags },
          exception: {
            values: [
              {
                type: "ApiNetworkError",
                value: apiNetworkFailureMessage(tags.api_network_class),
              },
            ],
          },
        }),
      addBreadcrumb: (data) =>
        scope.addBreadcrumb(
          { category: "api.network", level: "warning", data },
          30,
        ),
    },
    config.origin,
    () => config.routeTemplates,
  );
}

export function createBrowserDiagnostics(
  hostConfig: SentryConfig,
): WebDiagnostics {
  // Network reports may name only the operation path templates the app
  // registers (setApiRouteTemplates); until then every route is `other`. The
  // client and transport read this copy, so both privacy passes see them.
  const config: SentryConfig = { ...hostConfig };
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
    traceLifecycle: "static",
    tracesSampleRate: 0,
    dataCollection: privateDataCollection(),
    sendClientReports: false,
    maxBreadcrumbs: 30,
    beforeSend: (event) => sanitizeSentryEvent(event, config),
  });
  const scope = new Scope();
  scope.setClient(client);
  client.init();
  const network = apiNetworkFailureReporter(scope, config);
  const diagnostics: WebDiagnostics = {
    reportApiNetworkFailure: network,
    setApiRouteTemplates: (routes) => {
      config.routeTemplates = new Set(routes);
    },
    clearBreadcrumbs() {
      scope.clearBreadcrumbs();
      network.noteActivity();
    },
    addBreadcrumb({ area, action }) {
      if (!isDiagnosticArea(area) || !isDiagnosticAction(action)) return;
      scope.addBreadcrumb(
        { category: "app.activity", data: { area, action } },
        30,
      );
      // Logged failures add `error` crumbs during an outage; only user
      // activity starts a new run of network crumbs.
      if (action !== "error") network.noteActivity();
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
