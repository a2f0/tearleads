import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import { createTestAppHostConfig } from "../test/helpers/appTestHostConfig";
import { App } from "./App";
import { APP_HOST_PROFILES, type AppHostConfig } from "./host/AppHostConfig";
import {
  appFeatureFlagStorageKey,
  saveAppFeatureFlag,
} from "./providers/feature-flags/appFeatureFlags";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function renderApp(hostConfig: AppHostConfig): Promise<RenderResult> {
  let view: RenderResult | undefined;
  await act(async () => {
    view = render(<App hostConfig={hostConfig} />);
  });
  if (!view) throw new Error("App did not render");
  return view;
}

function wake() {
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyUp(window, { key: "Escape" });
}

test("bare desktop and Start menu launch lasers without replacing existing windows", async () => {
  const view = await renderApp(createTestAppHostConfig());
  const desktop = view.getByRole("application");
  const explorer = view.getByRole("region", { name: "Explorer" });
  fireEvent.contextMenu(desktop, { clientX: 100, clientY: 100 });
  fireEvent.click(view.getByRole("button", { name: "Start Screensaver" }));
  expect(view.getByRole("dialog")).toBeTruthy();
  expect(explorer.isConnected).toBe(true);
  wake();
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(view.queryByLabelText("PIN code")).toBeNull();
  expect(view.getByRole("region", { name: "Explorer" })).toBe(explorer);

  fireEvent.click(view.getByRole("button", { name: "Menu" }));
  fireEvent.click(view.getByRole("button", { name: "Start Screensaver" }));
  expect(view.getByRole("dialog")).toBeTruthy();
  wake();
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

test("one screensaver survives navigation changes across the workspace tree", async () => {
  saveAppFeatureFlag(appFeatureFlagStorageKey("workspace-switcher"), "enabled");
  const hostConfig = createTestAppHostConfig();
  const view = await renderApp(hostConfig);
  const desktop = view.container.querySelector(".pane:not(.pane-hidden)");
  if (!desktop) throw new Error("Expected visible desktop");
  fireEvent.contextMenu(desktop, { clientX: 100, clientY: 100 });
  fireEvent.click(view.getByRole("button", { name: "Start Screensaver" }));
  const dialog = view.getByRole("dialog");
  await act(async () => {
    view.rerender(
      <App
        hostConfig={hostConfig.withOverrides({ navigationMode: "routed" })}
      />,
    );
  });
  expect(view.getAllByRole("dialog")).toHaveLength(1);
  expect(view.getByRole("dialog")).toBe(dialog);
  wake();
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  const action = view.getByRole("button", { name: "Start Screensaver" });
  expect(action.closest(".routed-pane-taskbar")).not.toBeNull();
  fireEvent.click(action);
  expect(view.getAllByRole("dialog")).toHaveLength(1);
  wake();
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

test("the isolated demo never offers an app-wide privacy screen for independent peer PINs", async () => {
  const view = await renderApp(
    createTestAppHostConfig({ profile: APP_HOST_PROFILES.demo }),
  );
  fireEvent.contextMenu(view.getAllByRole("application")[0] as HTMLElement);
  expect(view.queryByRole("button", { name: "Start Screensaver" })).toBeNull();
});
