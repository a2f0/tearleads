import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { DiagnosticBreadcrumb } from "../../host/AppDiagnostics";
import { MiniAppRouteSegmentsProvider } from "../../navigation/MiniAppRouteSegmentsContext";
import { DiagnosticsProvider } from "../../providers/logging/DiagnosticsProvider";
import { MiniAppBoundary } from "./MiniAppBoundary";

afterEach(cleanup);

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
