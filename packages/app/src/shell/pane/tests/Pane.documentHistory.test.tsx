import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { registerAndWaitForUserId } from "../../../../test/helpers/identityPaneTestUtils";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  openContacts,
  openExplorer,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "../../../../test/helpers/paneTestUtils";
import { renderEmptyDesktop } from "../../../../test/helpers/renderEmptyDesktop";
import { EXPLORER_LABELS } from "../../../mini-apps/explorer/labels";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../../mini-apps/system-monitor/systemMonitorMode";
import { DeveloperModeProvider } from "../../../providers/developer-mode/DeveloperModeProvider";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";
import { Pane } from "../shell/Pane";

const realNow = Date.now;
let clockOffset = 0;

afterEach(async () => {
  Date.now = realNow;
  clockOffset = 0;
  await cleanupPaneTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

/** Move the clock a minute on, so the next edit is its own step of history. */
function aMinuteLater(): void {
  clockOffset += 60_000;
  Date.now = () => realNow() + clockOffset;
}

/** Step one stop back and wait for that version to be on screen. */
async function stepBack(window: HTMLElement, slider: HTMLInputElement) {
  const before = slider.value;
  fireEvent.click(
    within(window).getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryPreviousAction,
    }),
  );
  await waitFor(() => {
    expect(slider.value).not.toBe(before);
    expect(
      window
        .querySelector(".explorer-document-history-view")
        ?.getAttribute("aria-busy"),
    ).toBe("false");
  });
}

async function addAddress(window: HTMLElement, label: string, street: string) {
  const scope = within(window);
  fireEvent.click(await scope.findByRole("button", { name: "Add address" }));
  const form = within(
    await scope.findByRole("form", { name: "Address editor" }),
  );
  fireEvent.change(form.getByLabelText("Label"), { target: { value: label } });
  fireEvent.change(form.getByLabelText("Street address"), {
    target: { value: street },
  });
  fireEvent.click(form.getByRole("button", { name: "Save address" }));
  await waitFor(() => {
    expect(scope.queryByRole("form", { name: "Address editor" })).toBeNull();
    expect(scope.getByText(street)).toBeTruthy();
  });
}

/**
 * A registered pane with a contact that gained two addresses a minute apart,
 * open in Explorer's History on its newest stop.
 */
async function openContactHistory() {
  useTestApiAppHandlers();
  saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
  const view = renderEmptyDesktop(
    <DeveloperModeProvider>
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider
            autoProvisionEnabled
            hostConfig={createTestHostConfig()}
          >
            <Pane className="pane" />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>
    </DeveloperModeProvider>,
  );
  await generateIdentityAndWaitForDb(view);
  await registerAndWaitForUserId(view);
  const contactsWindow = await openContacts(view);
  const contacts = within(contactsWindow);
  fireEvent.click(await contacts.findByRole("menuitem", { name: "File" }));
  fireEvent.click(
    await contacts.findByRole("menuitem", { name: "New Contact" }),
  );
  fireEvent.change(await contacts.findByLabelText("First name"), {
    target: { value: "History owner" },
  });
  fireEvent.click(contacts.getByRole("button", { name: "Create" }));
  await contacts.findByRole("heading", { name: "History owner" });
  fireEvent.click(await contacts.findByRole("button", { name: "Edit" }));
  aMinuteLater();
  await addAddress(contactsWindow, "Home", "12 King Street");
  aMinuteLater();
  await addAddress(contactsWindow, "Work", "99 Queen Street");
  fireEvent.click(contacts.getByRole("button", { name: "Done" }));
  fireEvent.click(contacts.getByRole("button", { name: "Close window" }));

  const explorerWindow = await openExplorer(view);
  const explorer = within(explorerWindow);
  await waitFor(() =>
    expect(getExplorerContainerItem(explorerWindow, "Contacts")).toBeTruthy(),
  );
  fireEvent.click(getExplorerContainerItem(explorerWindow, "Contacts"));
  const table = within(
    await explorer.findByRole("table", { name: "Items in Contacts" }),
  );
  fireEvent.click(await table.findByRole("button", { name: "History owner" }));
  await waitFor(() =>
    expect(explorerWindow.textContent).toContain("99 Queen Street"),
  );

  fireEvent.click(
    await explorer.findByRole("button", {
      name: EXPLORER_LABELS.documentHistoryAction,
    }),
  );
  const slider = (await explorer.findByRole("slider", {
    name: EXPLORER_LABELS.documentHistoryPositionLabel,
  })) as HTMLInputElement;
  return { explorer, explorerWindow, slider, view };
}

test(
  "Explorer History steps a contact back through its address edits and restores one",
  async () => {
    const { explorer, explorerWindow, slider, view } =
      await openContactHistory();
    const lastStop = Number(slider.max);
    // Creation and the two address saves are at least three steps.
    expect(lastStop).toBeGreaterThanOrEqual(2);
    expect(slider.value).toBe(String(lastStop));
    await waitFor(() => {
      expect(explorerWindow.textContent).toContain("12 King Street");
      expect(explorerWindow.textContent).toContain("99 Queen Street");
    });
    // Once the edits have synced, the change names its signed uploader.
    await explorer.findByText(
      new RegExp(`^${EXPLORER_LABELS.documentHistoryUploadedBy} `, "u"),
      undefined,
      { timeout: 15_000 },
    );
    // A past version offers no way to edit it.
    expect(explorer.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(explorer.queryByRole("button", { name: "Add address" })).toBeNull();

    // Step back until the newest address is gone; the older one remains.
    for (let steps = 0; steps <= lastStop; steps += 1) {
      if (!explorerWindow.textContent?.includes("99 Queen Street")) break;
      await stepBack(explorerWindow, slider);
    }
    await waitFor(() =>
      expect(explorerWindow.textContent).not.toContain("99 Queen Street"),
    );
    expect(explorerWindow.textContent).toContain("12 King Street");
    expect(Number(slider.value)).toBeLessThan(lastStop);

    fireEvent.click(
      explorer.getByRole("button", {
        name: EXPLORER_LABELS.documentHistoryFirstAction,
      }),
    );
    await waitFor(() => {
      expect(slider.value).toBe("0");
      expect(explorerWindow.textContent).not.toContain("12 King Street");
    });

    fireEvent.click(
      explorer.getByRole("button", {
        name: EXPLORER_LABELS.documentHistoryLastAction,
      }),
    );
    await waitFor(() => {
      expect(slider.value).toBe(String(lastStop));
      expect(explorerWindow.textContent).toContain("99 Queen Street");
    });
    // The newest stop is the document as it is: nothing to restore.
    expect(
      explorer.queryByRole("button", {
        name: EXPLORER_LABELS.documentHistoryRestoreAction,
      }),
    ).toBeNull();

    // Go back to the version with only the first address and restore it.
    for (let steps = 0; steps <= lastStop; steps += 1) {
      if (!explorerWindow.textContent?.includes("99 Queen Street")) break;
      await stepBack(explorerWindow, slider);
    }
    expect(explorerWindow.textContent).toContain("12 King Street");
    aMinuteLater();
    fireEvent.click(
      await explorer.findByRole("button", {
        name: EXPLORER_LABELS.documentHistoryRestoreAction,
      }),
    );
    const dialog = within(
      await explorer.findByRole("dialog", {
        name: EXPLORER_LABELS.documentHistoryRestoreTitle,
      }),
    );
    fireEvent.click(
      dialog.getByRole("button", {
        name: EXPLORER_LABELS.documentHistoryRestoreConfirm,
      }),
    );
    // The restore is a new step: history reopens on it, one stop longer.
    await waitFor(() => {
      const reloaded = explorer.getByRole("slider", {
        name: EXPLORER_LABELS.documentHistoryPositionLabel,
      }) as HTMLInputElement;
      expect(Number(reloaded.max)).toBeGreaterThan(lastStop);
      expect(reloaded.value).toBe(reloaded.max);
      expect(explorerWindow.textContent).toContain("12 King Street");
      expect(explorerWindow.textContent).not.toContain("99 Queen Street");
    });

    // The live document now holds the restored version.
    const reopened = within(await openContacts(view));
    fireEvent.click(
      await reopened.findByRole("button", { name: "History owner" }),
    );
    await reopened.findByText("12 King Street");
    await waitFor(() =>
      expect(reopened.queryByText("99 Queen Street")).toBeNull(),
    );
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "Explorer History saves a past version of a contact as a separate contact",
  async () => {
    const { explorer, explorerWindow, slider } = await openContactHistory();
    const lastStop = Number(slider.max);
    const copyAction = { name: EXPLORER_LABELS.documentHistoryCopyAction };
    // Unlike a restore, a copy is offered on the newest stop too.
    await explorer.findByRole("button", copyAction);

    // Go back to the version with only the first address and copy it.
    for (let steps = 0; steps <= lastStop; steps += 1) {
      if (!explorerWindow.textContent?.includes("99 Queen Street")) break;
      await stepBack(explorerWindow, slider);
    }
    expect(explorerWindow.textContent).toContain("12 King Street");
    fireEvent.click(await explorer.findByRole("button", copyAction));
    const dialog = within(
      await explorer.findByRole("dialog", {
        name: EXPLORER_LABELS.documentHistoryCopyTitle,
      }),
    );
    fireEvent.click(
      dialog.getByRole("button", {
        name: EXPLORER_LABELS.documentHistoryCopyConfirm,
      }),
    );
    // Step on while the copy is being created: its outcome is still
    // reported, on whichever stop is selected when it finishes.
    fireEvent.click(
      explorer.getByRole("button", {
        name: EXPLORER_LABELS.documentHistoryNextAction,
      }),
    );
    await explorer.findByText(EXPLORER_LABELS.documentHistoryCopySaved);
    // The original gained no step: nothing was written to it.
    expect(Number(slider.max)).toBe(lastStop);
    expect(
      explorer.queryByText(EXPLORER_LABELS.documentHistoryNewerAvailable),
    ).toBeNull();

    // The copy is its own contact, holding the version it was saved from.
    fireEvent.click(
      explorer.getByRole("button", {
        name: EXPLORER_LABELS.documentHistoryCopyOpenAction,
      }),
    );
    await waitFor(() => {
      expect(
        explorer.queryByRole("slider", {
          name: EXPLORER_LABELS.documentHistoryPositionLabel,
        }),
      ).toBeNull();
      expect(explorerWindow.textContent).toContain("12 King Street");
      expect(explorerWindow.textContent).not.toContain("99 Queen Street");
    });
    // It shares no history with the original: its birth is its only step.
    fireEvent.click(
      await explorer.findByRole("button", {
        name: EXPLORER_LABELS.documentHistoryAction,
      }),
    );
    const copySlider = (await explorer.findByRole("slider", {
      name: EXPLORER_LABELS.documentHistoryPositionLabel,
    })) as HTMLInputElement;
    expect(copySlider.max).toBe("0");
    await waitFor(() =>
      expect(explorerWindow.textContent).toContain("12 King Street"),
    );

    // Contacts lists both, and the original still has both addresses.
    const openContactsTable = async () => {
      fireEvent.click(getExplorerContainerItem(explorerWindow, "Contacts"));
      return within(
        await explorer.findByRole("table", { name: "Items in Contacts" }),
      );
    };
    const withSecondAddress: boolean[] = [];
    for (const position of [0, 1]) {
      const table = await openContactsTable();
      await waitFor(() =>
        expect(
          table.getAllByRole("button", { name: "History owner" }),
        ).toHaveLength(2),
      );
      const row = table.getAllByRole("button", { name: "History owner" })[
        position
      ];
      if (!row) throw new Error("a History owner row is missing");
      fireEvent.click(row);
      await waitFor(() =>
        expect(explorerWindow.textContent).toContain("12 King Street"),
      );
      withSecondAddress.push(
        explorerWindow.textContent?.includes("99 Queen Street") ?? false,
      );
    }
    expect(withSecondAddress.toSorted()).toEqual([false, true]);

    // Me is one document per identity: its versions are never copied.
    fireEvent.click(
      await (await openContactsTable()).findByRole("button", { name: "You" }),
    );
    fireEvent.click(
      await explorer.findByRole("button", {
        name: EXPLORER_LABELS.documentHistoryAction,
      }),
    );
    await explorer.findByRole("slider", {
      name: EXPLORER_LABELS.documentHistoryPositionLabel,
    });
    await waitFor(() =>
      expect(
        explorerWindow
          .querySelector(".explorer-document-history-view")
          ?.getAttribute("aria-busy"),
      ).toBe("false"),
    );
    expect(explorer.queryByRole("button", copyAction)).toBeNull();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
