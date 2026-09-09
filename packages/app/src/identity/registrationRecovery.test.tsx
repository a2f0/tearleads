import { afterEach, expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { openIdentityManagerFromPane } from "../../test/helpers/identityPaneTestUtils";
import { useTestApiAppHandlers } from "../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  getExplorerContainerItem,
  getPaneStatusText,
  openExplorer,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPaneRuntimeToSettle,
} from "../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment);

test.each([false, true])(
  "a committed registration recovers its original identity and containers (retry: %s)",
  async (retry) => {
    useTestApiAppHandlers();
    const originalFetch = globalThis.fetch;
    let registeredUserId: string | null = null;
    let registrationCount = 0;
    let failedRecoveryCount = 0;
    const fetchWithLostResponse = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request = new Request(...args);
        const path = new URL(request.url).pathname;
        if (retry && path === "/auth/challenge" && failedRecoveryCount === 0) {
          failedRecoveryCount += 1;
          return new Response(null, { status: 503 });
        }
        const response = await originalFetch(...args);
        if (path === "/auth/register" && request.method === "POST") {
          registrationCount += 1;
          if (registrationCount > 1) {
            expect(response.status).toBe(409);
            return response;
          }
          expect(response.status).toBe(200);
          registeredUserId = (await response.json()).userId;
          return new Response(JSON.stringify({ error: "Response lost" }), {
            status: 524,
            headers: { "Content-Type": "application/json" },
          });
        }
        return response;
      },
      { preconnect: originalFetch.preconnect },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      fetchWithLostResponse,
    );
    try {
      const view = renderPane({
        hostConfig: createTestHostConfig({ autoProvisionIdentity: true }),
      });
      if (retry) {
        await waitFor(
          () => {
            expect(failedRecoveryCount).toBe(1);
            expect(getPaneStatusText(view)).toMatch(/userId:\s*none/);
          },
          { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
        );
        await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
        const manager = within(await openIdentityManagerFromPane(view));
        fireEvent.click(manager.getByRole("button", { name: "Register" }));
      }
      await waitFor(
        () => {
          expect(registeredUserId).not.toBeNull();
          expect(getPaneStatusText(view)).toContain(
            `userId: ${registeredUserId}`,
          );
          expect(getPaneStatusText(view)).not.toMatch(/session:\s*none/);
        },
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      );
      expect(registrationCount).toBe(retry ? 2 : 1);
      await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
      const explorer = await openExplorer(view);
      await waitFor(
        () => {
          expect(getExplorerContainerItem(explorer, "Trash")).toBeTruthy();
        },
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      );
      await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
      view.unmount();
    } finally {
      fetchSpy.mockRestore();
    }
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 3,
);
