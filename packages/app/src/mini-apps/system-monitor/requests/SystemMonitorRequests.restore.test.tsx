import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { registerAndWaitForUserId } from "../../../../test/helpers/identityPaneTestUtils";
import {
  listProxiedApiRequests,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { openSystemMonitor } from "../../../../test/helpers/openSystemMonitor";
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
    // The settle point tracks proxied traffic, but Explorer reads can still be
    // counted in flight on the client. Reconcile the counts at an instant when
    // neither identity has a request in flight, read in one snapshot.
    let snapshot = metrics.getSnapshot(fingerprint);
    let anonymousTotal = 0;
    let proxiedTotal = 0;
    await waitFor(() => {
      snapshot = metrics.getSnapshot(fingerprint);
      const anonymous = metrics.getSnapshot(null);
      expect(snapshot.inFlight).toBe(0);
      expect(anonymous.inFlight).toBe(0);
      anonymousTotal = anonymous.total;
      proxiedTotal = listProxiedApiRequests().length;
    });
    expect(snapshot.total).toBeGreaterThanOrEqual(beforeRestore);
    expect(snapshot.total + anonymousTotal).toBe(proxiedTotal);
    openSystemMonitor(restored);
    fireEvent.click(await restored.findByRole("tab", { name: "API Requests" }));
    const requests = within(
      restored.getByRole("region", { name: "API request counts" }),
    );
    const totalRow = requests.getByText("Total requests").closest("tr");
    // Background sync may issue requests after the settle point; the monitor
    // must show the live retained count, which can only have grown.
    await waitFor(() => {
      const live = metrics.getSnapshot(fingerprint).total;
      expect(live).toBeGreaterThanOrEqual(snapshot.total);
      expect(totalRow?.textContent).toBe(`Total requests${live}`);
    });
    for (const name of ["Requests by endpoint", "Request timing by endpoint"])
      expect(
        within(requests.getByRole("table", { name })).getByText(
          "POST /auth/register",
        ),
      ).toBeTruthy();
    restored.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);
