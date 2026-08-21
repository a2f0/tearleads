import { afterEach, expect, test } from "bun:test";
import type { SymCrypt } from "@symcrypt/client-sdk";
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
import { SystemMonitorDeveloperModeProvider } from "../../../mini-apps/system-monitor/systemMonitorDeveloperMode";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../../mini-apps/system-monitor/systemMonitorMode";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";
import { Pane } from "../shell/Pane";

afterEach(cleanupPaneTestEnvironment);

function SymCryptProbe({
  onReady,
}: {
  readonly onReady: (symcrypt: SymCrypt) => void;
}) {
  const symcrypt = useSymCrypt();
  useEffect(() => onReady(symcrypt), [onReady, symcrypt]);
  return null;
}

test(
  "fresh Contacts uses the authenticated personal org before its index catches up",
  async () => {
    useTestApiAppHandlers();
    saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
    const symcryptRef: { current: SymCrypt | null } = { current: null };
    // Mirrors production composition: Layout mounts the developer-mode
    // provider above every Pane.
    const view = render(
      <SystemMonitorDeveloperModeProvider>
        <DualPaneProvider>
          <PaneSideProvider side="left">
            <PaneProvider
              autoProvisionEnabled={false}
              hostConfig={createTestHostConfig()}
            >
              <SymCryptProbe
                onReady={(nextSymCrypt) => {
                  symcryptRef.current = nextSymCrypt;
                }}
              />
              <Pane className="pane" />
            </PaneProvider>
          </PaneSideProvider>
        </DualPaneProvider>
      </SystemMonitorDeveloperModeProvider>,
    );

    await waitFor(() => expect(symcryptRef.current).not.toBeNull());
    const symcrypt = symcryptRef.current;
    invariant(symcrypt, "SymCrypt runtime was not captured");
    const organizations = symcrypt.organizations;
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
    const symcryptRef: { current: SymCrypt | null } = { current: null };
    const view = render(
      <SystemMonitorDeveloperModeProvider>
        <DualPaneProvider>
          <PaneSideProvider side="left">
            <PaneProvider
              autoProvisionEnabled
              hostConfig={createTestHostConfig()}
            >
              <SymCryptProbe
                onReady={(nextSymCrypt) => {
                  symcryptRef.current = nextSymCrypt;
                }}
              />
              <Pane className="pane" />
            </PaneProvider>
          </PaneSideProvider>
        </DualPaneProvider>
      </SystemMonitorDeveloperModeProvider>,
    );

    await waitFor(() => expect(symcryptRef.current).not.toBeNull());
    const symcrypt = symcryptRef.current;
    invariant(symcrypt, "SymCrypt runtime was not captured");

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

    const personalOrganizationId = symcrypt.session.defaultOrganizationId;
    invariant(personalOrganizationId, "Personal organization was not set");
    const containerTree = symcrypt.containerContents.openTree({
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
      symcrypt.session.createOrganization({
        organizationProfileName: "Custom Org",
      }),
    );
    invariant(
      additionalOrganization,
      "Additional organization was not created",
    );
    act(() => {
      symcrypt.session.setContext({
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
      const contacts = await symcrypt.documents.list({
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
        const movedContact = await symcrypt.containerContents
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
