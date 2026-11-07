import { afterEach, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import { openSystemMonitor } from "../../../../test/helpers/openSystemMonitor";
import {
  cleanupPaneTestEnvironment,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test("Clear logs in the toolbar empties the log without confirmation", async () => {
  const view = renderPane({ pinSystemMonitor: false });
  openSystemMonitor(view);
  await view.findByRole("tab", { name: "Logs" });
  const log = () => view.container.querySelector(".pane-log")?.textContent;
  expect(log()).toContain("Activity: system-monitor.open");

  const clear = view.getByRole("button", { name: "Clear logs" });
  expect(clear.closest(".window-toolbar")).not.toBeNull();
  // The API Requests tab's reset belongs to that tab alone.
  expect(
    view.queryByRole("button", { name: "Reset request counts" }),
  ).toBeNull();
  fireEvent.click(clear);

  expect(log()).not.toContain("Activity:");
  // The boot hint describes the pane's state rather than a logged event.
  expect(log()).toContain(
    "Generate a key pair from the pane menu to boot this pane.",
  );
  expect(view.queryByRole("dialog")).toBeNull();

  fireEvent.click(view.getByRole("tab", { name: "API Requests" }));
  expect(view.queryByRole("button", { name: "Clear logs" })).toBeNull();

  view.unmount();
});
