import {
  createServerDiagnostics,
  type MainProcessErrorSource,
} from "@tearleads/diagnostics/server";
import { resolveElectrobunMainSentryConfig } from "./mainSentryConfig";

export interface MainProcessReporter {
  captureError(error: unknown, source: MainProcessErrorSource): void;
  flush(): PromiseLike<boolean>;
}

function inlinedSentryValues() {
  const values =
    typeof TEARLEADS_ELECTROBUN_MAIN_SENTRY === "object"
      ? TEARLEADS_ELECTROBUN_MAIN_SENTRY
      : null;
  return {
    dsn: values?.dsn,
    environment: values?.environment,
    commit: values?.commit,
  };
}

// Sentry builds events synchronously; a hostile error (throwing getter,
// non-string stack, revoked Proxy) can make capture throw. Reporting must never
// change what the app does.
function captureQuietly(
  reporter: MainProcessReporter,
  error: unknown,
  source: MainProcessErrorSource,
): void {
  try {
    reporter.captureError(error, source);
  } catch {
    return;
  }
}

// electrobun/bun registers, while the bundle loads, an uncaughtException
// listener that stops the native loop and force-exits synchronously; a report
// could never flush. Take the event over: log, report, flush (<=2 s), then run
// Electrobun's own shutdown. A second crash during the flush shuts down at once.
// Rejections: Electrobun only logs and continues; so does this.
export function installMainProcessReporting(
  reporter: MainProcessReporter,
): void {
  const shutdown = process.listeners("uncaughtException");
  process.removeAllListeners("uncaughtException");
  let crashing = false;
  let shuttingDown = false;
  const shutDown = (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!shutdown.length) process.exit(1);
    for (const listener of shutdown) listener(error, origin);
  };
  process.on("uncaughtException", (error, origin) => {
    if (crashing) {
      shutDown(error, origin);
      return;
    }
    crashing = true;
    console.error(
      "electrobun: uncaught exception; reporting before shutdown",
      error,
    );
    captureQuietly(reporter, error, "unhandled-error");
    void Promise.resolve()
      .then(() => reporter.flush())
      .catch(() => false)
      .finally(() => shutDown(error, origin));
  });
  process.on("unhandledRejection", (reason) =>
    captureQuietly(reporter, reason, "unhandled-rejection"),
  );
}

export function configureMainProcessDiagnostics(
  moduleUrl: string,
): MainProcessReporter | undefined {
  try {
    const config = resolveElectrobunMainSentryConfig({
      ...inlinedSentryValues(),
      moduleUrl,
    });
    if (!config) return undefined;
    const client = createServerDiagnostics(config);
    const reporter: MainProcessReporter = {
      captureError: (error, source) => captureQuietly(client, error, source),
      flush: () =>
        Promise.resolve()
          .then(() => client.flush())
          .catch(() => false),
    };
    installMainProcessReporting(reporter);
    return reporter;
  } catch {
    // Diagnostics must not prevent the app from starting.
    return undefined;
  }
}
