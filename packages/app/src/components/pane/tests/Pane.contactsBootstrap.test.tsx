import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { useEffect } from "react";
import { registerAndWaitForUserId } from "../../../../test/helpers/identityPaneTestUtils";
import { useTestApiAppHandlers } from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  openContacts,
  openExplorer,
  openNotes,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "../../../../test/helpers/paneTestUtils";
import { CONTACTS_LABELS } from "../../../mini-apps/contacts/labels";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../../mini-apps/system-monitor/systemMonitorMode";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { Pane } from "../Pane";
import { PaneProvider } from "../PaneProvider";

afterEach(cleanupPaneTestEnvironment);

function TearleadsProbe({
  onReady,
}: {
  readonly onReady: (tearleads: Tearleads) => void;
}) {
  const tearleads = useTearleads();
  useEffect(() => onReady(tearleads), [onReady, tearleads]);
  return null;
}

test(
  "fresh Contacts uses the authenticated personal org before its index catches up",
  async () => {
    useTestApiAppHandlers();
    saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
    const tearleadsRef: { current: Tearleads | null } = { current: null };
    const view = render(
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider
            autoProvisionEnabled={false}
            hostConfig={createTestHostConfig()}
          >
            <TearleadsProbe
              onReady={(nextTearleads) => {
                tearleadsRef.current = nextTearleads;
              }}
            />
            <Pane className="pane" />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>,
    );

    await waitFor(() => expect(tearleadsRef.current).not.toBeNull());
    const tearleads = tearleadsRef.current;
    invariant(tearleads, "Tearleads runtime was not captured");
    const organizations = tearleads.organizations;
    organizations.listLocalOrganizations = async () => [];

    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);
    const contactsWindow = await openContacts(view);

    await waitFor(() => {
      expect(
        within(contactsWindow).getByText(CONTACTS_LABELS.emptyState),
      ).toBeTruthy();
      expect(
        within(contactsWindow).queryByText(CONTACTS_LABELS.loadingState),
      ).toBeNull();
    });
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "Contacts stays personal and Notes loads after another org becomes active",
  async () => {
    useTestApiAppHandlers();
    saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
    const tearleadsRef: { current: Tearleads | null } = { current: null };
    const view = render(
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider
            autoProvisionEnabled
            hostConfig={createTestHostConfig()}
          >
            <TearleadsProbe
              onReady={(nextTearleads) => {
                tearleadsRef.current = nextTearleads;
              }}
            />
            <Pane className="pane" />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>,
    );

    await waitFor(() => expect(tearleadsRef.current).not.toBeNull());
    const tearleads = tearleadsRef.current;
    invariant(tearleads, "Tearleads runtime was not captured");

    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);

    const explorerWindow = await openExplorer(view);
    await waitFor(
      () => {
        expect(
          getExplorerContainerItem(explorerWindow, "Contacts"),
        ).toBeTruthy();
      },
      { timeout: 10_000 },
    );
    act(() => {
      fireEvent.click(getExplorerContainerItem(explorerWindow, "Contacts"));
    });
    await waitFor(
      () => {
        const contactsTable = within(explorerWindow).getByRole("table", {
          name: "Items in Contacts",
        });
        expect(
          within(contactsTable).getByRole("button", { name: "You" }),
        ).toBeTruthy();
      },
      { timeout: 10_000 },
    );

    const additionalOrganization = await act(() =>
      tearleads.session.createOrganization({
        organizationProfileName: "Custom Org",
      }),
    );
    invariant(
      additionalOrganization,
      "Additional organization was not created",
    );
    act(() => {
      tearleads.session.setContext({
        containerId: additionalOrganization.containerId,
        organizationId: additionalOrganization.organizationId,
      });
    });

    const notesWindow = await openNotes(view);
    expect(
      within(notesWindow).getByRole("textbox", { name: /Notes editor/ }),
    ).toBeTruthy();

    const contactsWindow = await openContacts(view);
    await waitFor(
      () => {
        expect(
          within(contactsWindow).queryByText(CONTACTS_LABELS.loadingState)
            ?.textContent ?? null,
        ).toBeNull();
        expect(
          within(contactsWindow).getByRole("button", { name: "You" }),
        ).toBeTruthy();
      },
      { timeout: 5_000 },
    );
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
