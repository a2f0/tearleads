import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { DiagnosticBreadcrumb } from "../../../host/AppDiagnostics";
import { DiagnosticsProvider } from "../../../providers/logging/DiagnosticsProvider";
import { useExplorerViewBreadcrumb } from "./useExplorerViewBreadcrumb";

afterEach(cleanup);

test("Explorer view transitions report static labels without container IDs", () => {
  const breadcrumbs: DiagnosticBreadcrumb[] = [];
  const diagnostics = {
    addBreadcrumb: (value: DiagnosticBreadcrumb) => breadcrumbs.push(value),
    captureError: () => {},
  };
  const input = {
    containerId: null as string | null,
    trashContainerId: "private-trash-id",
    documentSelected: false,
    rootSelected: false,
  };
  const view = renderHook(useExplorerViewBreadcrumb, {
    initialProps: input,
    wrapper: ({ children }: PropsWithChildren) => (
      <DiagnosticsProvider value={diagnostics}>{children}</DiagnosticsProvider>
    ),
  });
  expect(breadcrumbs).toEqual([]);
  view.rerender({
    ...input,
    containerId: "private-root-id",
    rootSelected: true,
  });
  view.rerender({
    ...input,
    containerId: "private-root-id",
    rootSelected: true,
  });
  view.rerender({ ...input, containerId: "private-trash-id" });
  view.rerender({ ...input, containerId: "private-folder-id" });
  view.rerender({ ...input, documentSelected: true });
  expect(breadcrumbs).toEqual([
    { area: "explorer", action: "root-view" },
    { area: "explorer", action: "trash-view" },
    { area: "explorer", action: "folder-view" },
    { area: "explorer", action: "document-view" },
  ]);
});
