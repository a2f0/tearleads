import { afterEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { registerAndWaitForUserId } from "../../../../test/helpers/identityPaneTestUtils";
import { useTestApiAppHandlers } from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createExplorerChildContainer,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  getSelectedExplorerContainerSyncLabel,
  openExplorer,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  summarizeProxiedApiRequests,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import {
  appFeatureFlagStorageKey,
  saveAppFeatureFlag,
} from "../../../providers/feature-flags/appFeatureFlags";

afterEach(cleanupPaneTestEnvironment);

test("registered explorer child folders settle to synced in the pane UI", async () => {
  useTestApiAppHandlers();
  // The Explorer detail header's sync dot is the observable this asserts on,
  // and it ships off — the footer tray is what reports sync by default — so the
  // flag goes on for this test rather than the assertion moving elsewhere.
  saveAppFeatureFlag(
    appFeatureFlagStorageKey("explorer-header-sync-indicator"),
    "enabled",
  );
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);
  await registerAndWaitForUserId(view);
  const explorer = await openExplorer(view);

  await waitFor(() => {
    expect(getExplorerContainerItem(explorer, "/")).toBeTruthy();
  });

  await createExplorerChildContainer(view, explorer, "Docs");
  await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);

  await waitFor(
    () => {
      expect(
        getSelectedExplorerContainerSyncLabel(explorer),
        `Child folder did not sync.\nrequests=\n${summarizeProxiedApiRequests()}`,
      ).toBe("Synced");
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );

  view.unmount();
}, 30_000);
