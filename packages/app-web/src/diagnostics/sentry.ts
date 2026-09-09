import { BrowserClient, defaultStackParser, Scope } from "@sentry/browser";
import {
  type AppDiagnostics,
  isDiagnosticAction,
  isDiagnosticArea,
} from "app/host/AppDiagnostics";
import {
  resolveSentryConfig,
  type SentryConfig,
  type SentryInput,
} from "./sentryConfig";
import { sanitizeSentryEvent } from "./sentryPrivacy";
import { createPrivateSentryTransport } from "./sentryTransport";

export interface WebDiagnostics extends AppDiagnostics {
  dispose: () => PromiseLike<boolean>;
}

export function configureSentry(
  input: SentryInput,
): WebDiagnostics | undefined {
  try {
    const config = resolveSentryConfig(input);
    return config ? createDiagnostics(config) : undefined;
  } catch {
    // Telemetry initialization must never prevent the application from booting.
    return undefined;
  }
}

function createDiagnostics(config: SentryConfig): WebDiagnostics {
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
    sendDefaultPii: false,
    sendClientReports: false,
    enableLogs: false,
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
