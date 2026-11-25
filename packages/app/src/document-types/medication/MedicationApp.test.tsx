import { afterEach, expect, test } from "bun:test";
import { hasPendingLocalDocumentWrites } from "@tearleads/client-sdk";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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

afterEach(async () => {
  cleanup();
  await cleanupPaneTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test(
  "Explorer keeps prescribed directions apart from a logged dose across a restart",
  async () => {
    const storage = createPersistedPaneStorage();
    const localIdentityNamespace = "medication-reopen";
    const hostConfig = createTestHostConfig({
      localIdentityNamespace,
    }).withOverrides({ createSQLiteRuntime: storage.createRuntime });
    const { view, sdk } = renderLifecyclePane(hostConfig);
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(panel.getByRole("button", { name: "Medication" }));

    for (const [name, value] of [
      ["Medication", "Lisinopril"],
      ["Strength", "10 mg"],
      ["Directions", "Take 1 tablet by mouth once daily"],
    ] as const) {
      const input = await waitFor(() => {
        const control = panel.getByRole<HTMLInputElement>("textbox", { name });
        expect(control.disabled).toBe(false);
        return control;
      });
      fireEvent.change(input, { target: { value } });
      await waitFor(() => expect(input.value).toBe(value));
    }

    fireEvent.click(panel.getByRole("button", { name: "Log Dose" }));
    const takenAt = panel.getByLabelText<HTMLInputElement>("New dose taken");
    expect(takenAt.getAttribute("type")).toBe("datetime-local");
    expect(takenAt.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
    fireEvent.change(takenAt, { target: { value: "2026-07-16T08:30" } });
    fireEvent.change(panel.getByLabelText("New dose amount"), {
      target: { value: "Half tablet" },
    });
    fireEvent.change(panel.getByLabelText("New dose notes"), {
      target: { value: "Dizzy, halved" },
    });
    const save = panel.getByRole<HTMLButtonElement>("button", {
      name: "Save Dose",
    });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await panel.findByDisplayValue("Half tablet");
    fireEvent.click(panel.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(hasPendingLocalDocumentWrites(sdk().domainScope)).toBe(false),
    );
    await waitForPersistedPaneLocalIdentity(localIdentityNamespace);
    view.unmount();
    await waitFor(
      () =>
        expect(storage.workers.every((worker) => worker.terminated)).toBe(true),
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    const reopened = renderPane({ hostConfig });
    await waitFor(
      () =>
        expect(getPaneStatusText(reopened)).toMatch(/sqlite worker:\s*ready/u),
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );
    const restarted = await openExplorer(reopened);
    fireEvent.click(
      await within(restarted).findByRole("button", {
        name: "Lisinopril 10 mg",
      }),
    );
    const restored = within(restarted);
    await waitFor(() => {
      const log = restored.getByRole("table", { name: "Intake Log" });
      expect(log.textContent).toContain("2026-07-16 08:30");
      expect(log.textContent).toContain("Half tablet");
      // The logged half dose leaves the prescription's words as written.
      expect(
        restored.getByText("Take 1 tablet by mouth once daily"),
      ).toBeTruthy();
    });
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
