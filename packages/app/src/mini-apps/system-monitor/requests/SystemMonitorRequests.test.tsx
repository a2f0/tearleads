import { afterEach, expect, test } from "bun:test";
import { listSessionsOperation } from "@tearleads/validators/operation";
import { act, fireEvent, within } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";
import { getApiRequestMetrics } from "../../../providers/api/apiRequestMetrics";

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
    fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
    fireEvent.click(await view.findByRole("tab", { name: "API Requests" }));
    return within(view.getByRole("table", { name: "Requests by endpoint" }));
  };
  const view = renderPane({ hostConfig, pinSystemMonitor: false });
  let table = await open(view);
  expect(table.getByText("GET /auth/sessions")).toBeTruthy();
  act(() => {
    metrics.begin(null, listSessionsOperation)("failed");
  });
  expect(table.getByText("2")).toBeTruthy();
  fireEvent.click(view.getByRole("tab", { name: "Logs" }));
  fireEvent.click(view.getByRole("tab", { name: "API Requests" }));
  expect(table.getByText("2")).toBeTruthy();
  view.unmount();
  const reopened = renderPane({ hostConfig, pinSystemMonitor: false });
  table = await open(reopened);
  expect(table.getByText("2")).toBeTruthy();
  fireEvent.click(
    reopened.getByRole("button", { name: "Reset request counts" }),
  );
  expect(reopened.getByText("No API requests recorded yet.")).toBeTruthy();
  expect(metrics.getSnapshot(null).total).toBe(0);
  reopened.unmount();
});
