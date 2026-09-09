import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { DiagnosticBreadcrumb } from "../../host/AppDiagnostics";
import { MiniAppRouteSegmentsProvider } from "../../navigation/MiniAppRouteSegmentsContext";
import { DiagnosticsProvider } from "../../providers/logging/DiagnosticsProvider";
import { LogProvider } from "../../providers/logging/LogProvider";
import { PaneLog } from "../pane/log/PaneLog";
import { MiniAppBoundary } from "./MiniAppBoundary";

afterEach(cleanup);

test.each([false, true])(
  "render failures stay in System Monitor with remote reporting enabled=%s",
  (enabled) => {
    const error = new Error("private document title");
    const reports: unknown[] = [];
    const diagnostics = enabled
      ? {
          addBreadcrumb: () => {},
          captureError: (value: unknown) => reports.push(value),
        }
      : undefined;
    function Failure(): never {
      throw error;
    }
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = render(
        <DiagnosticsProvider value={diagnostics}>
          <LogProvider diagnostics={diagnostics}>
            <MiniAppRouteSegmentsProvider
              appId="explorer"
              canGoBack={false}
              goBack={() => {}}
              pathSegments={[]}
              setPathSegments={() => {}}
            >
              <MiniAppBoundary appId="explorer">
                <Failure />
              </MiniAppBoundary>
            </MiniAppRouteSegmentsProvider>
            <PaneLog />
          </LogProvider>
        </DiagnosticsProvider>,
      );
      expect(
        view.getByText(/Mini-app render failed: Error: private document title/),
      ).toBeTruthy();
      expect(view.getByRole("alert").textContent).not.toContain(error.message);
      expect(reports).toEqual(enabled ? [error] : []);
    } finally {
      consoleSpy.mockRestore();
    }
  },
);

test("mini-app navigation records activity without route values or rendered text", () => {
  const breadcrumbs: DiagnosticBreadcrumb[] = [];
  const diagnostics = {
    addBreadcrumb: (value: DiagnosticBreadcrumb) => breadcrumbs.push(value),
    captureError: () => {},
  };
  function View({ segments }: { segments: string[] }) {
    return (
      <DiagnosticsProvider value={diagnostics}>
        <MiniAppRouteSegmentsProvider
          appId="explorer"
          canGoBack={false}
          goBack={() => {}}
          pathSegments={segments}
          setPathSegments={() => {}}
        >
          <MiniAppBoundary appId="explorer">
            <p>Private document title</p>
          </MiniAppBoundary>
        </MiniAppRouteSegmentsProvider>
      </DiagnosticsProvider>
    );
  }
  const view = render(
    <View segments={["containers", "private-container-id"]} />,
  );
  view.rerender(<View segments={["containers", "private-trash-id"]} />);
  view.rerender(<View segments={["containers", "private-root-id"]} />);
  expect(breadcrumbs).toEqual([
    { area: "explorer", action: "open" },
    { area: "explorer", action: "navigate" },
    { area: "explorer", action: "navigate" },
  ]);
  expect(JSON.stringify(breadcrumbs)).not.toContain("private");
});
