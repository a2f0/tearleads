import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { registerAndWaitForUserId } from "../../../../test/helpers/identityPaneTestUtils";
import {
  listProxiedApiRequests,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPanePublicKey,
  getPaneStatusText,
  openExplorer,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPaneRuntimeToSettle,
  waitForPersistedPaneLocalIdentity,
} from "../../../../test/helpers/paneTestUtils";
import { getApiRequestMetrics } from "../../../providers/api/apiRequestMetrics";

afterEach(cleanupPaneTestEnvironment);

test(
  "restoring an identity and syncing Explorer retains requests before opening the monitor",
  async () => {
    useTestApiAppHandlers();
    const namespace = `request-restore-${crypto.randomUUID()}`;
    const hostConfig = createTestHostConfig({
      localIdentityNamespace: namespace,
    });
    const metrics = getApiRequestMetrics(
      hostConfig.apiBaseUrl,
      `${namespace}.left`,
    );
    const view = renderPane({ hostConfig });
    await generateIdentityAndWaitForDb(view);
    await waitForPersistedPaneLocalIdentity(namespace);
    const fingerprint = getPanePublicKey(view);
    await registerAndWaitForUserId(view);
    await openExplorer(view);
    await waitForPaneRuntimeToSettle();
    const beforeRestore = metrics.getSnapshot(fingerprint).total;
    expect(beforeRestore).toBeGreaterThan(0);
    view.unmount();
    const restored = renderPane({ hostConfig });
    await waitFor(
      () => {
        expect(getPaneStatusText(restored)).toContain(
          `publicKey: ${fingerprint}`,
        );
        expect(getPaneStatusText(restored)).not.toMatch(/session:\s*none/);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await openExplorer(restored);
    await waitForPaneRuntimeToSettle();
    const snapshot = metrics.getSnapshot(fingerprint);
    expect(snapshot.total).toBeGreaterThanOrEqual(beforeRestore);
    expect(snapshot.inFlight).toBe(0);
    expect(snapshot.total + metrics.getSnapshot(null).total).toBe(
      listProxiedApiRequests().length,
    );
    fireEvent.click(restored.getByRole("button", { name: "System Monitor" }));
    fireEvent.click(await restored.findByRole("tab", { name: "API Requests" }));
    const requests = within(
      restored.getByRole("region", { name: "API request counts" }),
    );
    const totalRow = requests.getByText("Total requests").closest("tr");
    expect(totalRow?.textContent).toBe(`Total requests${snapshot.total}`);
    expect(requests.getByText("POST /auth/register")).toBeTruthy();
    restored.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);
