import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";
import { appFeatureFlagStorageKey } from "../../../providers/feature-flags/appFeatureFlags";

afterEach(async () => {
  await cleanupPaneTestEnvironment();
  window.history.replaceState(null, "", "/");
});

const BUILT_IN_SYSTEM_CONTAINERS_FEATURE_FLAG_KEY = appFeatureFlagStorageKey(
  "built-in-system-containers",
);
const DOCUMENT_EDIT_RANGES_FEATURE_FLAG_KEY = appFeatureFlagStorageKey(
  "document-edit-ranges",
);
const EXPLORER_HEADER_SYNC_INDICATOR_FEATURE_FLAG_KEY =
  appFeatureFlagStorageKey("explorer-header-sync-indicator");
const LINKED_DOCUMENT_ACTIVATION_CONTROLS_FEATURE_FLAG_KEY =
  appFeatureFlagStorageKey("linked-document-activation-controls");
const WORKSPACE_SWITCHER_FEATURE_FLAG_KEY =
  appFeatureFlagStorageKey("workspace-switcher");

async function clickWindowViewMenuItem(
  view: ReturnType<typeof renderPane>,
  name: string,
) {
  fireEvent.click(view.getByRole("menuitem", { name: "View" }));
  fireEvent.click(await view.findByRole("menuitem", { name }));
}

test("feature flags tab is developer-only and toggles app flags", async () => {
  const view = renderPane({ pinSystemMonitor: false });

  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  await view.findByRole("tab", { name: "Logs" });
  expect(view.queryByRole("tab", { name: "Feature Flags" })).toBeNull();
  expect(
    globalThis.localStorage.getItem(
      BUILT_IN_SYSTEM_CONTAINERS_FEATURE_FLAG_KEY,
    ),
  ).toBeNull();
  expect(
    globalThis.localStorage.getItem(
      LINKED_DOCUMENT_ACTIVATION_CONTROLS_FEATURE_FLAG_KEY,
    ),
  ).toBeNull();

  await clickWindowViewMenuItem(view, "Enable Developer Mode");

  const featureFlagsTab = await view.findByRole("tab", {
    name: "Feature Flags",
  });
  fireEvent.click(featureFlagsTab);

  const builtInSystemContainersToggle = view.getByRole("switch", {
    name: "Show built-in system containers",
  }) as HTMLInputElement;
  const documentEditRangesToggle = view.getByRole("switch", {
    name: "Show document edit ranges",
  }) as HTMLInputElement;
  const explorerHeaderSyncIndicatorToggle = view.getByRole("switch", {
    name: "Show Explorer header sync indicator",
  }) as HTMLInputElement;
  const linkedDocumentActivationControlsToggle = view.getByRole("switch", {
    name: "Enable linked document activation controls",
  }) as HTMLInputElement;
  const workspaceSwitcherToggle = view.getByRole("switch", {
    name: "Show workspace switcher",
  }) as HTMLInputElement;
  expect(builtInSystemContainersToggle.checked).toBe(false);
  expect(documentEditRangesToggle.checked).toBe(false);
  expect(explorerHeaderSyncIndicatorToggle.checked).toBe(false);
  expect(linkedDocumentActivationControlsToggle.checked).toBe(false);
  expect(workspaceSwitcherToggle.checked).toBe(false);
  expect(view.getAllByText("Disabled")).toHaveLength(5);

  fireEvent.click(builtInSystemContainersToggle);

  await waitFor(() => {
    expect(builtInSystemContainersToggle.checked).toBe(true);
    expect(
      globalThis.localStorage.getItem(
        BUILT_IN_SYSTEM_CONTAINERS_FEATURE_FLAG_KEY,
      ),
    ).toBe("enabled");
    expect(view.getByText("Enabled")).toBeTruthy();
  });

  fireEvent.click(documentEditRangesToggle);

  await waitFor(() => {
    expect(documentEditRangesToggle.checked).toBe(true);
    expect(
      globalThis.localStorage.getItem(DOCUMENT_EDIT_RANGES_FEATURE_FLAG_KEY),
    ).toBe("enabled");
    expect(view.getAllByText("Enabled")).toHaveLength(2);
  });

  fireEvent.click(explorerHeaderSyncIndicatorToggle);

  await waitFor(() => {
    expect(explorerHeaderSyncIndicatorToggle.checked).toBe(true);
    expect(
      globalThis.localStorage.getItem(
        EXPLORER_HEADER_SYNC_INDICATOR_FEATURE_FLAG_KEY,
      ),
    ).toBe("enabled");
    expect(view.getAllByText("Enabled")).toHaveLength(3);
  });

  fireEvent.click(linkedDocumentActivationControlsToggle);

  await waitFor(() => {
    expect(linkedDocumentActivationControlsToggle.checked).toBe(true);
    expect(
      globalThis.localStorage.getItem(
        LINKED_DOCUMENT_ACTIVATION_CONTROLS_FEATURE_FLAG_KEY,
      ),
    ).toBe("enabled");
    expect(view.getAllByText("Enabled")).toHaveLength(4);
  });

  fireEvent.click(workspaceSwitcherToggle);

  await waitFor(() => {
    expect(workspaceSwitcherToggle.checked).toBe(true);
    expect(
      globalThis.localStorage.getItem(WORKSPACE_SWITCHER_FEATURE_FLAG_KEY),
    ).toBe("enabled");
    expect(view.getAllByText("Enabled")).toHaveLength(5);
  });

  await clickWindowViewMenuItem(view, "Disable Developer Mode");

  expect(view.queryByRole("tab", { name: "Feature Flags" })).toBeNull();

  view.unmount();
});
