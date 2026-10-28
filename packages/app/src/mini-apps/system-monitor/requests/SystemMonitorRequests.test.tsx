import { afterEach, expect, spyOn, test } from "bun:test";
import { listSessionsOperation } from "@tearleads/validators/operation";
import { act, fireEvent, within } from "@testing-library/react";
import { openSystemMonitor } from "../../../../test/helpers/openSystemMonitor";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";
import { getApiRequestMetrics } from "../../../providers/api/apiRequestMetrics";
import * as Status from "../../../shell/pane/status/useSystemStatusSnapshot";

afterEach(cleanupPaneTestEnvironment);

test("API Requests shows earlier traffic, updates live, survives reopening and resets", async () => {
  const hostConfig = createTestHostConfig({
    localIdentityNamespace: "request-monitor-test",
  });
  const metrics = getApiRequestMetrics(
    hostConfig.apiBaseUrl,
    `${hostConfig.localIdentityNamespace}.left`,
  );
  metrics.reset(null);
  metrics.begin(null, listSessionsOperation)("succeeded");
  const open = async (view: ReturnType<typeof renderPane>) => {
    openSystemMonitor(view);
    fireEvent.click(await view.findByRole("tab", { name: "API Requests" }));
    return within(view.getByRole("table", { name: "Requests by endpoint" }));
  };
  const view = renderPane({ hostConfig, pinSystemMonitor: false });
  let table = await open(view);
  expect(table.getByText("GET /auth/sessions")).toBeTruthy();
  act(() => {
    metrics.begin(null, listSessionsOperation)("failed", {
      totalMs: 42,
      databaseMs: 17,
    });
  });
  expect(table.getByText("2")).toBeTruthy();
  const timing = within(
    view.getByRole("table", { name: "Request timing by endpoint" }),
  );
  expect(timing.getByText("GET /auth/sessions")).toBeTruthy();
  expect(timing.getByText("42")).toBeTruthy();
  expect(timing.getByText("17")).toBeTruthy();
  fireEvent.click(view.getByRole("tab", { name: "Logs" }));
  fireEvent.click(view.getByRole("tab", { name: "API Requests" }));
  table = within(view.getByRole("table", { name: "Requests by endpoint" }));
  expect(table.getByText("2")).toBeTruthy();
  expect(table.getByText("2").isConnected).toBe(true);
  view.unmount();
  const reopened = renderPane({ hostConfig, pinSystemMonitor: false });
  table = await open(reopened);
  expect(table.getByText("2")).toBeTruthy();
  fireEvent.click(
    reopened.getByRole("button", { name: "Reset request counts" }),
  );
  expect(reopened.getByText("No API requests recorded yet.")).toBeTruthy();
  expect(reopened.getByText("No timed API requests yet.")).toBeTruthy();
  expect(metrics.getSnapshot(null).total).toBe(0);
  reopened.unmount();
});

test("copy reports read current counts without subscribing the Logs tab to requests", async () => {
  const hostConfig = createTestHostConfig({
    localIdentityNamespace: "request-report-test",
  });
  const metrics = getApiRequestMetrics(
    hostConfig.apiBaseUrl,
    `${hostConfig.localIdentityNamespace}.left`,
  );
  metrics.reset(null);
  const status = spyOn(Status, "useSystemStatusSnapshot");
  let copied = "";
  const previousClipboard = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "clipboard",
  );
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({
      writeText: async (text: string) => {
        copied = text;
      },
    }),
  });
  try {
    const view = renderPane({ hostConfig, pinSystemMonitor: false });
    openSystemMonitor(view);
    await view.findByRole("tab", { name: "Logs" });
    const before = status.mock.calls.length;
    act(() => {
      metrics.begin(null, listSessionsOperation)("succeeded");
    });
    expect(status.mock.calls.length).toBe(before);
    fireEvent.click(
      view.getByRole("button", { name: "Copy report for support" }),
    );
    expect(copied).toContain("| Total requests | 1 |");
    expect(copied).toContain("| GET /auth/sessions | 1 | 0 | 1 | 0 | 0 |");
    view.unmount();
  } finally {
    status.mockRestore();
    if (previousClipboard)
      Object.defineProperty(
        Navigator.prototype,
        "clipboard",
        previousClipboard,
      );
    else Reflect.deleteProperty(Navigator.prototype, "clipboard");
  }
});
