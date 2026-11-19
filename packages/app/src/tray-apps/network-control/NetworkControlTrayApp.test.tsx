import { afterEach, expect, test } from "bun:test";
import { DisplayProperties } from "@tearleads/windowing";
import { fireEvent, within } from "@testing-library/react";
import {
  getPaneRoot,
  renderDualPane,
} from "../../../test/helpers/dual-pane/dualPaneCore";
import {
  cleanupPaneTestEnvironment,
  getPaneStatusText,
  renderPane,
} from "../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment);

test("Network Control is opt-in, remembers visibility, and controls the pane", () => {
  // Existing installs can already have an older disabled-app list.
  localStorage.setItem("test.tray.disabled", JSON.stringify(["sync-status"]));
  const view = renderPane({ children: <DisplayProperties /> });
  expect(view.getByRole("switch", { name: "Sync Status" })).toHaveProperty(
    "checked",
    false,
  );
  const toggle = view.getByRole("switch", { name: "Network Control" });
  const trigger = { name: /^Network Control:/ };
  expect(toggle).toHaveProperty("checked", false);
  expect(view.queryByRole("button", trigger)).toBeNull();
  fireEvent.click(toggle);

  for (const [action, status] of [
    ["Force Offline", "offline (manual)"],
    ["Force Online", "online (manual)"],
  ] as const) {
    fireEvent.click(view.getByRole("button", trigger));
    fireEvent.click(view.getByRole("button", { name: action }));
    expect(getPaneStatusText(view)).toContain(status);
  }

  fireEvent(window, new Event("offline"));
  expect(getPaneStatusText(view)).toContain("online (manual)");
  fireEvent.click(view.getByRole("button", trigger));
  fireEvent.click(view.getByRole("button", { name: "Use Automatic Network" }));
  expect(
    view.getByRole("button", { name: "Network Control: offline (automatic)" }),
  ).toBeTruthy();

  view.unmount();
  const remounted = renderPane({ children: <DisplayProperties /> });
  expect(remounted.getByRole("button", trigger)).toBeTruthy();
  expect(
    remounted.getByRole("switch", { name: "Network Control" }),
  ).toHaveProperty("checked", true);
  fireEvent.contextMenu(remounted.getByRole("button", trigger));
  fireEvent.click(
    remounted.getByRole("button", { name: "Disable Network Control" }),
  );
  expect(remounted.queryByRole("button", trigger)).toBeNull();
});

test("forcing one pane offline leaves the other pane in automatic mode", () => {
  localStorage.setItem(
    "test.tray.disabled",
    JSON.stringify(["sync-status", { enabled: "network-control" }]),
  );
  const view = renderDualPane({
    autoProvisionLeft: false,
    autoProvisionRight: false,
  });
  const left = within(getPaneRoot(view, "left"));
  const right = within(getPaneRoot(view, "right"));
  fireEvent(window, new Event("online"));
  fireEvent.click(
    left.getByRole("button", { name: "Network Control: online (automatic)" }),
  );
  fireEvent.click(view.getByRole("button", { name: "Force Offline" }));
  expect(
    left.getByRole("button", { name: "Network Control: offline (manual)" }),
  ).toBeTruthy();
  expect(
    right.getByRole("button", { name: "Network Control: online (automatic)" }),
  ).toBeTruthy();
});
