import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createExplorerChildContainer,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

// Explorer applies persisted document-summary updates on a 200 ms trailing
// timer. Wait past it to catch a stored kind replacing the optimistic kind.
const PERSISTED_SUMMARY_SETTLE_MS = 300;

async function waitForPersistedSummaryFlush() {
  await act(
    () =>
      new Promise((resolve) =>
        setTimeout(resolve, PERSISTED_SUMMARY_SETTLE_MS),
      ),
  );
}

test(
  "Explorer file menu filters document types and creates the selected kind",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    await openExplorerNewStructuredDocumentRoute(explorer);
    const picker = within(
      within(explorer).getByRole("region", { name: "New document" }),
    );
    const search = picker.getByRole("searchbox", {
      name: "Search document types",
    });
    const allTypes = picker
      .getAllByRole("button")
      .map((button) => button.textContent);

    fireEvent.change(search, { target: { value: "  cArD  " } });
    expect(
      picker.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Credit Card"]);

    fireEvent.change(search, { target: { value: "no matching type" } });
    expect(picker.queryAllByRole("button")).toEqual([]);
    expect(picker.getByRole("status").textContent).toBe(
      "No document types match your search.",
    );

    for (const value of ["", "   "]) {
      fireEvent.change(search, { target: { value } });
      expect(
        picker.getAllByRole("button").map((button) => button.textContent),
      ).toEqual(allTypes);
      expect(picker.getByRole("status").textContent).toBe("");
    }
    fireEvent.change(search, { target: { value: "credit" } });
    expect(
      picker.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Credit Card"]);

    fireEvent.click(
      within(explorer).getByRole("button", { name: "Credit Card" }),
    );

    await waitFor(() => {
      const input = within(explorer).getByLabelText("Credit card number");
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Expected a credit card number input.");
      }
      expect(input.disabled).toBe(false);
      expect(input.type).toBe("text");
    });
    await waitForPersistedSummaryFlush();
    expect(
      (
        within(explorer).getByLabelText(
          "Credit card number",
        ) as HTMLInputElement
      ).type,
    ).toBe("text");
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "Explorer resets search for another container and creates the selected kind",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    await createExplorerChildContainer(view, explorer, "Documents");
    fireEvent.click(getExplorerContainerItem(explorer, "/"));
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.change(
      within(explorer).getByRole("searchbox", {
        name: "Search document types",
      }),
      { target: { value: "no matching type" } },
    );
    fireEvent.contextMenu(getExplorerContainerItem(explorer, "Documents"), {
      clientX: 180,
      clientY: 180,
    });
    const contextMenu = await waitFor(() => {
      const menu = view.baseElement.querySelector<HTMLElement>(".menu");
      if (!menu) {
        throw new Error("Expected the Explorer context menu.");
      }
      return menu;
    });
    fireEvent.click(
      within(contextMenu).getByRole("button", { name: "New Document" }),
    );
    fireEvent.click(
      await within(explorer).findByRole("button", {
        name: "Driver's License",
      }),
    );

    await waitFor(() => {
      const input = within(explorer).getByLabelText(
        "Driver's license ID number",
      );
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Expected a driver's license ID input.");
      }
      expect(input.disabled).toBe(false);
    });
    await waitForPersistedSummaryFlush();
    expect(
      within(explorer).getByLabelText("Driver's license ID number"),
    ).toBeTruthy();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
