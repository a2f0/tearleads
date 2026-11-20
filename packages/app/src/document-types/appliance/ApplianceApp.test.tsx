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
  "Explorer selects and clears an appliance avatar while keeping its gallery and receipt separate",
  async () => {
    const view = renderPane();
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(panel.getByRole("button", { name: "Appliance" }));
    const input = await waitFor(() => {
      const control = panel.getByLabelText<HTMLInputElement>("Photos");
      expect(control.disabled).toBe(false);
      return control;
    });
    fireEvent.change(input, {
      target: {
        files: [new File(["appliance"], "washer.png", { type: "image/png" })],
      },
    });
    fireEvent.change(panel.getByLabelText("Receipt"), {
      target: {
        files: [new File(["receipt"], "receipt.png", { type: "image/png" })],
      },
    });
    await panel.findByText("receipt.png");
    const select = await panel.findByRole("combobox", { name: "Avatar photo" });
    fireEvent.click(select);
    const menu = within(document.body);
    expect(menu.queryByRole("option", { name: /receipt.png/ })).toBeNull();
    fireEvent.click(menu.getByRole("option", { name: /washer.png/ }));
    const remove = await panel.findByRole<HTMLButtonElement>("button", {
      name: "Remove Avatar",
    });
    await waitFor(() => expect(remove.disabled).toBe(false));
    expect(await panel.findByAltText("Avatar for Appliance")).toBeTruthy();
    fireEvent.click(remove);
    await waitFor(() =>
      expect(panel.queryByRole("button", { name: "Remove Avatar" })).toBeNull(),
    );
    expect(panel.getByText("washer.png")).toBeTruthy();
    expect(panel.getByText("receipt.png")).toBeTruthy();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
