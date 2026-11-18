import { afterEach, expect, test } from "bun:test";
import { hasPendingLocalDocumentWrites } from "@tearleads/client-sdk";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { getExplorerSidebarItem } from "../../../test/helpers/dual-pane/dualPaneCore";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../test/helpers/msw/server";
import { renderLifecyclePane } from "../../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPaneStatusText,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPersistedPaneLocalIdentity,
} from "../../../test/helpers/paneTestUtils";
import { createPersistedPaneStorage } from "../../../test/helpers/persistedPaneStorage";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test(
  "Explorer edits the two eyes independently and displays the saved notation",
  async () => {
    const storage = createPersistedPaneStorage();
    const localIdentityNamespace = "eyeglass-prescription-reopen";
    const hostConfig = createTestHostConfig({
      localIdentityNamespace,
    }).withOverrides({
      createSQLiteRuntime: storage.createRuntime,
    });
    const { view, sdk } = renderLifecyclePane(hostConfig);
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(
      panel.getByRole("button", { name: "Eyeglass Prescription" }),
    );

    for (const [name, value] of [
      ["Patient Name", "Alex Rivera"],
      ["Right (OD) Sphere", "+1.00"],
      ["Left (OS) Sphere", "PL"],
    ] as const) {
      const input = await waitFor(() => {
        const control = panel.getByRole<HTMLInputElement>("textbox", { name });
        expect(control.disabled).toBe(false);
        return control;
      });
      fireEvent.change(input, { target: { value } });
      await waitFor(() => expect(input.value).toBe(value));
    }
    fireEvent.click(panel.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(hasPendingLocalDocumentWrites(sdk().domainScope)).toBe(false),
    );
    await waitForPersistedPaneLocalIdentity(localIdentityNamespace);
    view.unmount();
    await waitFor(() =>
      expect(storage.workers.every((worker) => worker.terminated)).toBe(true),
    );
    const reopened = renderPane({ hostConfig });
    await waitFor(() =>
      expect(getPaneStatusText(reopened)).toMatch(/sqlite worker:\s*ready/u),
    );
    const restarted = await openExplorer(reopened);
    fireEvent.click(
      await waitFor(() =>
        getExplorerSidebarItem(restarted, "Eyeglass Prescription Alex Rivera"),
      ),
    );
    const restored = within(restarted);
    await waitFor(() => {
      expect(
        restored.getByText("Right (OD) Sphere").closest(".mini-app-row")
          ?.textContent,
      ).toContain("+1.00");
      expect(
        restored.getByText("Left (OS) Sphere").closest(".mini-app-row")
          ?.textContent,
      ).toContain("PL");
    });
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
