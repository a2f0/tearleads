import { afterEach, expect, test } from "bun:test";
import { createMemoryBlobStore } from "@tearleads/client-sdk";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";
import { createBlobStoreDesktopStateStorage } from "../shell/usePaneDesktopStateStorage";

afterEach(cleanupPaneTestEnvironment);

test("the desktop layout reads back what it wrote to the blob store", async () => {
  const blobStore = createMemoryBlobStore();
  const storage = createBlobStoreDesktopStateStorage(blobStore);

  expect(await storage.read()).toBeNull();
  await storage.write('{"icons":{},"version":1}');
  expect(await storage.read()).toBe('{"icons":{},"version":1}');
  expect(await createBlobStoreDesktopStateStorage(blobStore).read()).toBe(
    '{"icons":{},"version":1}',
  );
});

test(
  "the desktop shows Explorer once the pane has an identity",
  async () => {
    const view = renderPane();
    expect(view.queryByRole("listbox", { name: "Desktop" })).toBeNull();

    await generateIdentityAndWaitForDb(view);
    const desktop = await view.findByRole("listbox", { name: "Desktop" });
    const options = within(desktop).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Explorer"]);

    const explorer = within(desktop).getByRole("option", { name: "Explorer" });
    const windowTitles = () =>
      Array.from(
        view.baseElement.querySelectorAll(".window-titlebar-title"),
        (title) => title.textContent,
      );
    expect(windowTitles()).toEqual([]);
    await act(async () => {
      fireEvent.contextMenu(explorer, { clientX: 40, clientY: 40 });
    });
    const menu = view.baseElement.querySelector<HTMLElement>(".menu");
    expect(menu).not.toBeNull();
    await act(async () => {
      fireEvent.click(
        within(menu ?? view.baseElement).getByRole("button", { name: "Open" }),
      );
    });
    await waitFor(() => expect(windowTitles()).toEqual(["Explorer"]));
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
