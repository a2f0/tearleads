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
import { PaneProvider } from "../runtime/PaneProvider";
import { Pane } from "../shell/Pane";

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

    const personalOrganizationId = tearleads.session.defaultOrganizationId;
    invariant(personalOrganizationId, "Personal organization was not set");
    const containerTree = tearleads.containerContents.openTree({
      logLabel: "Contacts custom-org regression",
    });
    let personalTrashId: string | null = null;
    await waitFor(() => {
      const nodes = containerTree.getSnapshot().nodes;
      const personalRoot = nodes.find(
        (node) =>
          node.organizationId === personalOrganizationId &&
          node.parentId === null,
      );
      const personalTrash = nodes.find(
        (node) =>
          node.organizationId === personalOrganizationId &&
          node.name === "Trash" &&
          node.parentId === personalRoot?.id,
      );
      expect(personalTrash).toBeTruthy();
      personalTrashId = personalTrash?.id ?? null;
    });
    invariant(personalTrashId, "Personal Trash was not provisioned");

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
          within(contactsWindow).queryByText(CONTACTS_LABELS.loadingState),
        ).toBeNull();
        expect(
          within(contactsWindow).getByRole("button", { name: "You" }),
        ).toBeTruthy();
      },
      { timeout: 5_000 },
    );

    fireEvent.click(
      within(contactsWindow).getByRole("menuitem", { name: "File" }),
    );
    const newContactMenuItem = await within(contactsWindow).findByRole(
      "menuitem",
      { name: CONTACTS_LABELS.newContactAction },
    );
    invariant(
      newContactMenuItem instanceof HTMLButtonElement,
      "New Contact menu item was not a button",
    );
    expect(newContactMenuItem.disabled).toBe(false);
    fireEvent.click(newContactMenuItem);

    fireEvent.change(
      await within(contactsWindow).findByLabelText(
        CONTACTS_LABELS.firstNameField,
      ),
      { target: { value: "Ada" } },
    );
    fireEvent.change(
      within(contactsWindow).getByLabelText(CONTACTS_LABELS.lastNameField),
      { target: { value: "Lovelace" } },
    );
    const createContactButton = within(contactsWindow).getByRole("button", {
      name: CONTACTS_LABELS.createContactAction,
    });
    invariant(
      createContactButton instanceof HTMLButtonElement,
      "Create Contact action was not a button",
    );
    await waitFor(() => expect(createContactButton.disabled).toBe(false));
    fireEvent.click(createContactButton);

    const createdContactButton = await within(contactsWindow).findByRole(
      "button",
      { name: "Ada Lovelace" },
    );
    let createdContactId: string | null = null;
    await waitFor(async () => {
      const contacts = await tearleads.documents.list({
        documentKind: "contact",
      });
      createdContactId =
        contacts?.rows.find((contact) => contact.title === "Ada Lovelace")
          ?.id ?? null;
      expect(createdContactId).not.toBeNull();
    });
    invariant(createdContactId, "Created contact was not persisted");
    const persistedContactId = createdContactId;

    fireEvent.contextMenu(createdContactButton, {
      clientX: 200,
      clientY: 200,
    });
    const contextMenu = await waitFor(() => {
      const menu = view.baseElement.querySelector<HTMLElement>(".menu");
      invariant(menu, "Contacts context menu was not rendered");
      return menu;
    });
    fireEvent.click(
      within(contextMenu).getByRole("button", {
        name: CONTACTS_LABELS.removeContactAction,
      }),
    );

    await waitFor(
      async () => {
        const movedContact = await tearleads.containerContents
          .documentQueries()
          .loadDocumentSummary(persistedContactId);
        expect(movedContact?.containerId).toBe(personalTrashId);
      },
      { timeout: 10_000 },
    );
    await waitFor(
      () => {
        expect(
          within(contactsWindow).queryByRole("button", {
            name: "Ada Lovelace",
          }),
        ).toBeNull();
      },
      { timeout: 10_000 },
    );
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
