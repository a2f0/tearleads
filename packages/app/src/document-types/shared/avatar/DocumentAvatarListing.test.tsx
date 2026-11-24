import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  listExplorerNoteItems,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

function findListedDocument(explorer: HTMLElement, name: string) {
  const row = listExplorerNoteItems(explorer).find(
    (button) => button.textContent?.trim() === name,
  );
  if (!row) {
    throw new Error(`Expected the listed document "${name}".`);
  }
  return row;
}

test.each([
  ["Appliance", "Untitled appliance"],
  ["Tool", "Untitled tool"],
])(
  "Explorer lists %s documents by their chosen avatar, and by the kind's glyph in the avatar circle before one is chosen",
  async (kindLabel, untitledTitle) => {
    const view = renderPane();
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(panel.getByRole("button", { name: kindLabel }));
    await waitFor(() => {
      expect(panel.getByLabelText<HTMLInputElement>("Photos").disabled).toBe(
        false,
      );
    });

    fireEvent.click(getExplorerContainerItem(explorer, "/"));
    const withoutAvatar = await waitFor(() => {
      const row = findListedDocument(explorer, untitledTitle);
      expect(row.querySelector(".document-avatar-fallback")).not.toBeNull();
      return row;
    });
    expect(withoutAvatar.querySelector(".document-avatar-image")).toBeNull();
    expect(withoutAvatar.querySelector(".explorer-item-icon")).toBeNull();

    fireEvent.click(withoutAvatar);
    fireEvent.click(await panel.findByRole("button", { name: "Edit" }));
    fireEvent.change(
      await waitFor(() => {
        const control = panel.getByLabelText<HTMLInputElement>("Photos");
        expect(control.disabled).toBe(false);
        return control;
      }),
      {
        target: {
          files: [new File([kindLabel], "portrait.png", { type: "image/png" })],
        },
      },
    );
    fireEvent.click(
      await panel.findByRole("combobox", { name: "Avatar photo" }),
    );
    fireEvent.click(
      within(document.body).getByRole("option", { name: /portrait.png/ }),
    );
    expect(await panel.findByAltText(`Avatar for ${kindLabel}`)).toBeTruthy();

    fireEvent.click(getExplorerContainerItem(explorer, "/"));
    await waitFor(() => {
      const image = findListedDocument(
        explorer,
        untitledTitle,
      ).querySelector<HTMLImageElement>("img.document-avatar-image");
      expect(image?.getAttribute("src")).toStartWith("blob:");
    });
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
