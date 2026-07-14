import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  renderPane,
} from "../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment);

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

test("Explorer file menu creates the selected document kind", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);
  const explorer = await openExplorer(view);
  await openExplorerNewStructuredDocumentRoute(explorer);

  fireEvent.click(
    within(explorer).getByRole("button", { name: "Credit Card" }),
  );

  await waitFor(() => {
    const input = within(explorer).getByLabelText("Credit card number");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected a credit card number input.");
    }
    expect(input.disabled).toBe(false);
  });
  await waitForPersistedSummaryFlush();
  expect(within(explorer).getByLabelText("Credit card number")).toBeTruthy();
});

test("Explorer context menu creates the selected document kind", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);
  const explorer = await openExplorer(view);
  fireEvent.contextMenu(getExplorerContainerItem(explorer, "/"), {
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
    const input = within(explorer).getByLabelText("Driver's license ID number");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected a driver's license ID input.");
    }
    expect(input.disabled).toBe(false);
  });
  await waitForPersistedSummaryFlush();
  expect(
    within(explorer).getByLabelText("Driver's license ID number"),
  ).toBeTruthy();
});
