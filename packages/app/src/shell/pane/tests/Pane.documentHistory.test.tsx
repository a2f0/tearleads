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

test(
  "Explorer History steps a contact back through its address edits, read-only",
  async () => {
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
    fireEvent.click(
      await table.findByRole("button", { name: "History owner" }),
    );
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
    const lastStop = Number(slider.max);
    // Creation and the two address saves are at least three steps.
    expect(lastStop).toBeGreaterThanOrEqual(2);
    expect(slider.value).toBe(String(lastStop));
    await waitFor(() => {
      expect(explorerWindow.textContent).toContain("12 King Street");
      expect(explorerWindow.textContent).toContain("99 Queen Street");
    });
    // A past version offers no way to edit it.
    expect(explorer.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(explorer.queryByRole("button", { name: "Add address" })).toBeNull();

    const previous = explorer.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryPreviousAction,
    });
    // Step back until the newest address is gone; the older one remains.
    for (let steps = 0; steps <= lastStop; steps += 1) {
      if (!explorerWindow.textContent?.includes("99 Queen Street")) break;
      const before = slider.value;
      fireEvent.click(previous);
      await waitFor(() => expect(slider.value).not.toBe(before));
      await waitFor(() =>
        expect(
          explorer.queryByText(EXPLORER_LABELS.documentHistoryLoading),
        ).toBeNull(),
      );
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

    // The live document was never rewound: Contacts still shows both.
    const reopened = within(await openContacts(view));
    fireEvent.click(
      await reopened.findByRole("button", { name: "History owner" }),
    );
    await reopened.findByText("12 King Street");
    expect(reopened.getByText("99 Queen Street")).toBeTruthy();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
