import { afterEach, expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DiagnosticBreadcrumb } from "../../host/AppDiagnostics";
import { PaneLog } from "../../shell/pane/log/PaneLog";
import {
  DiagnosticAreaContext,
  DiagnosticsProvider,
} from "./DiagnosticsProvider";
import { LogProvider, useLog } from "./LogProvider";
import { useDiagnosticBreadcrumb } from "./useDiagnosticBreadcrumb";

afterEach(cleanup);

test("recording activity does not rerender controls that only write logs", () => {
  let renders = 0;
  function Control() {
    renders++;
    const { log } = useLog();
    const breadcrumb = useDiagnosticBreadcrumb();
    return (
      <button
        type="button"
        onClick={() => {
          log("Local log entry");
          breadcrumb("open");
        }}
      >
        Open
      </button>
    );
  }
  const view = render(
    <LogProvider>
      <Control />
      <PaneLog />
    </LogProvider>,
  );
  const initialRenders = renders;
  fireEvent.click(view.getByText("Open"));
  expect(view.getByText(/Activity: app.open/)).toBeTruthy();
  expect(renders).toBe(initialRenders);
});

test("System Monitor retains raw logs while remote breadcrumbs use only the explicit vocabulary", () => {
  const breadcrumbs: DiagnosticBreadcrumb[] = [];
  const errors: unknown[] = [];
  const diagnostics = {
    addBreadcrumb: (value: DiagnosticBreadcrumb) => breadcrumbs.push(value),
    captureError: (error: unknown) => errors.push(error),
  };
  const error = new Error("private crypto key");
  function Harness() {
    const { log, logError } = useLog();
    const breadcrumb = useDiagnosticBreadcrumb();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            log("decrypted contact: private@example.test");
            breadcrumb("move-to-trash");
            logError("private filename", error);
            logError("string-only private log");
          }}
        >
          Act
        </button>
        <PaneLog />
      </>
    );
  }
  const view = render(
    <DiagnosticsProvider value={diagnostics}>
      <DiagnosticAreaContext.Provider value="explorer">
        <LogProvider diagnostics={diagnostics}>
          <Harness />
        </LogProvider>
      </DiagnosticAreaContext.Provider>
    </DiagnosticsProvider>,
  );
  fireEvent.click(view.getByText("Act"));
  expect(view.getByText(/private@example.test/)).toBeTruthy();
  expect(view.getByText(/Activity: explorer.move-to-trash/)).toBeTruthy();
  expect(breadcrumbs).toEqual([
    { area: "explorer", action: "move-to-trash" },
    { area: "app", action: "error" },
    { area: "app", action: "error" },
  ]);
  // The adapter receives Error objects for stack extraction, never formatted logs.
  expect(errors).toEqual([error]);
});

// #3360: callers that retry a refusal behind another tab's transaction log it
// with `log`. One reported as an error is work nothing retried, so it is lost
// and must reach diagnostics like any other failure.
test("a busy database refusal reported as an error still reaches diagnostics", () => {
  const errors: unknown[] = [];
  const diagnostics = {
    addBreadcrumb: () => undefined,
    captureError: (error: unknown) => errors.push(error),
  };
  const busy = new Error("Failed query", {
    cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
  });
  function Harness() {
    const { logError } = useLog();
    return (
      <button
        type="button"
        onClick={() => logError("Documents: attachment write failed", busy)}
      >
        Act
      </button>
    );
  }
  const view = render(
    <LogProvider diagnostics={diagnostics}>
      <Harness />
    </LogProvider>,
  );
  fireEvent.click(view.getByText("Act"));
  expect(errors).toEqual([busy]);
});
