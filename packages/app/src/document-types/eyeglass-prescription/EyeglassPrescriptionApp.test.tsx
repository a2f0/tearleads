import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test(
  "Explorer edits the two eyes independently and displays the saved notation",
  async () => {
    const view = renderPane();
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(
      panel.getByRole("button", { name: "Eyeglass Prescription" }),
    );

    for (const [name, value] of [
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
    await waitFor(() => {
      expect(panel.getByText("+1.00")).toBeTruthy();
      expect(panel.getByText("PL")).toBeTruthy();
      expect(panel.queryByLabelText("Right (OD) Sphere")).toBeNull();
    });
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
