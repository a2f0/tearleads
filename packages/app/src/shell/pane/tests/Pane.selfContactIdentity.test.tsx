import { afterEach, expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  type Tearleads,
} from "@tearleads/client-sdk";
import { WindowStateProvider } from "@tearleads/windowing";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";
import { MiniAppBusProvider } from "../../../mini-apps/bus";
import { ContactsContextMenuLayer } from "../../../mini-apps/contacts/context-menu/ContactsContextMenu";
import { useContactsModel } from "../../../mini-apps/contacts/hooks/useContactsModel";
import { CONTACTS_LABELS } from "../../../mini-apps/contacts/labels";
import { MINI_APP_LAUNCHER } from "../../../mini-apps/registry";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { useUserSystemContainers } from "../../../providers/system-bootstrap/UserSystemContainersProvider";
import {
  ContactsProvider,
  useContacts,
} from "../../../stores/contacts/ContactsProvider";
import { getSelfContactLocalId } from "../../../stores/contacts/selfContact";
import { useDeviceFirstContainerContents } from "../../../stores/device-first/DeviceFirstProvider";

const WAIT_OPTIONS = { timeout: PANE_ASYNC_TEST_TIMEOUT_MS };
afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

type Capture = {
  contacts: ReturnType<typeof useContacts>;
  contents: ReturnType<typeof useDeviceFirstContainerContents>;
  model: ReturnType<typeof useContactsModel>;
  sdk: Tearleads;
  trashSlot: string | null;
};

function captureContactsModel() {
  const captured: { current: Capture | null } = { current: null };
  function Probe() {
    const sdk = useTearleads();
    const contacts = useContacts();
    const contents = useDeviceFirstContainerContents();
    const trashSlot =
      useUserSystemContainers().find((item) => item.kind === "trash")
        ?.systemSlot ?? null;
    const [sidebar, setSidebar] = useState<ReactNode>(null);
    const model = useContactsModel(setSidebar);
    useLayoutEffect(() => {
      captured.current = { contacts, contents, model, sdk, trashSlot };
    }, [contacts, contents, model, sdk, trashSlot]);
    return (
      <section aria-label="Identity Contacts probe">
        {sidebar}
        <ContactsContextMenuLayer
          {...model.contextMenuState}
          canWrite={model.canWrite}
          openImportContactRoute={model.openImportContactRoute}
          openNewContactRoute={model.openNewContactRoute}
          ready={model.ready}
        />
      </section>
    );
  }
  const view = renderPane({
    children: (
      <WindowStateProvider>
        <AppNavigationProvider
          defaultWindowEnabled={false}
          launcher={MINI_APP_LAUNCHER}
          mode="windowed"
        >
          <MiniAppBusProvider>
            <ContactsProvider>
              <Probe />
            </ContactsProvider>
          </MiniAppBusProvider>
        </AppNavigationProvider>
      </WindowStateProvider>
    ),
  });
  return {
    view,
    current: () => {
      invariant(captured.current, "Contacts model was not committed");
      return captured.current;
    },
    openMenu: (name: string) => {
      const probe = within(
        view.getByRole("region", { name: "Identity Contacts probe" }),
      );
      fireEvent.contextMenu(probe.getByRole("button", { name }));
    },
  };
}

// Composition coverage: real providers/model/SQLite, not a supplied identity
// port. This same-database generation change is not a different-account switch.
test(
  "Contacts model retires a retained removal callback after database A-B-A",
  async () => {
    const { view, current, openMenu } = captureContactsModel();
    await generateIdentityAndWaitForDb(view);
    const sdk = current().sdk;
    const selfId = getSelfContactLocalId(sdk.identity.signingFingerprint ?? "");
    await waitFor(() => {
      expect(current().model.ready).toBe(true);
      expect(current().model.selectedContactId).toBe(selfId);
    }, WAIT_OPTIONS);
    openMenu("You");
    expect(current().model.contextMenuState.canRemoveContextMenuContact).toBe(
      false,
    );
    expect(
      view
        .getByRole("button", { name: CONTACTS_LABELS.removeContactAction })
        .hasAttribute("disabled"),
    ).toBe(true);
    act(() => current().model.contextMenuState.closeContextMenu());
    const created: { id: string | null } = { id: null };
    await act(async () => {
      created.id = await current().contacts.createContact({
        firstName: "Ordinary",
      });
    });
    invariant(created.id, "Ordinary contact was not persisted");
    const id = created.id;
    await waitFor(
      () =>
        expect(
          current().contacts.entries.some((entry) => entry.id === id),
        ).toBe(true),
      WAIT_OPTIONS,
    );
    openMenu("Ordinary");
    await waitFor(
      () =>
        expect(
          current().model.contextMenuState.canRemoveContextMenuContact,
        ).toBe(true),
      WAIT_OPTIONS,
    );
    const retainedRemove =
      current().model.contextMenuState.removeContextMenuContact;
    const database = sdk.database.snapshot;
    invariant(database.execSql, "SQLite executor is missing");
    const before = await defaultDocumentsPersistence.loadDocument(
      database.execSql,
      id,
    );
    invariant(
      before?.containerId,
      "Ordinary contact has no persisted placement",
    );
    const version = sdk.runtime.version;
    await act(async () => {
      sdk.database.clear();
      sdk.database.configure(database);
      // Invoke before yielding: no rerender may replace the retained callback.
      await retainedRemove();
    });
    expect(sdk.runtime.version).toBeGreaterThan(version);
    expect(sdk.database.execSql).toBe(database.execSql);
    expect(sdk.database.client).toBe(database.client);
    expect(sdk.database.id).toBe(database.id);
    expect(sdk.database.status).toBe(database.status);
    // Lower store guards can prevent writes while a broken model closes its menu.
    expect(current().model.contextMenuState.contextMenu?.id).toEqual({
      kind: "contact",
      contactId: id,
    });
    expect(
      (await defaultDocumentsPersistence.loadDocument(database.execSql, id))
        ?.containerId,
    ).toBe(before.containerId);
    await waitFor(
      () =>
        expect(
          current().model.contextMenuState.canRemoveContextMenuContact,
        ).toBe(true),
      WAIT_OPTIONS,
    );
    await act(async () => {
      await current().model.contextMenuState.removeContextMenuContact();
    });
    const moved = await defaultDocumentsPersistence.loadDocument(
      database.execSql,
      id,
    );
    invariant(moved?.containerId, "Removed contact lost its durable record");
    expect({
      placementChanged: moved.containerId !== before.containerId,
      menuClosed: current().model.contextMenuState.contextMenu === null,
    }).toEqual({ placementChanged: true, menuClosed: true });
    invariant(current().trashSlot, "Trash system slot is missing");
    await waitFor(() => {
      const destination = current()
        .contents.containerStore.getSnapshot()
        .nodes.find((node) => node.id === moved.containerId);
      expect(destination?.systemSlot).toBe(current().trashSlot);
    }, WAIT_OPTIONS);
    expect(current().model.contextMenuState.contextMenu).toBeNull();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

// The menu/store composition tests exercise the real refreshable authority.
// Here a held admission port isolates its forwarding through the real provider
// and SDK move, which a test-side copy of the consumer adapter cannot prove.
test.each([false, true])(
  "Contacts provider carries late removal admission (admit=%s)",
  async (admit) => {
    const { view, current } = captureContactsModel();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let pending: Promise<void> | undefined;
    try {
      await generateIdentityAndWaitForDb(view);
      await waitFor(() => {
        expect(current().model.ready).toBe(true);
        expect(current().contacts.canWrite).toBe(true);
      }, WAIT_OPTIONS);
      let contactId: string | null = null;
      await act(async () => {
        contactId = await current().contacts.createContact({
          firstName: "Late admission",
        });
      });
      invariant(contactId, "Contact was not persisted");
      const id = contactId;
      const sql = current().sdk.database.execSql;
      invariant(sql, "SQLite executor is missing");
      const before = await defaultDocumentsPersistence.loadDocument(sql, id);
      invariant(before?.containerId, "Contact has no persisted placement");
      let admissions = 0;
      let settled = false;
      await act(async () => {
        pending = current()
          .contacts.removeContact(id, {
            isCurrent: () => true,
            runWhenCurrent: async (work) => {
              admissions += 1;
              entered.resolve();
              await release.promise;
              return admit ? work() : null;
            },
          })
          .then(() => {
            settled = true;
          });
        await Promise.race([
          entered.promise,
          pending.then(() => {
            throw new Error("Removal settled before caller admission");
          }),
        ]);
      });
      expect(admissions).toBe(1);
      expect(settled).toBe(false);
      expect(await defaultDocumentsPersistence.loadDocument(sql, id)).toEqual(
        before,
      );
      await act(async () => {
        release.resolve();
        await pending;
      });
      expect(settled).toBe(true);
      const after = await defaultDocumentsPersistence.loadDocument(sql, id);
      invariant(after?.containerId, "Contact lost its durable record");
      if (!admit) {
        expect(after).toEqual(before);
      } else {
        expect(after.containerId).not.toBe(before.containerId);
        await waitFor(() => {
          const destination = current()
            .contents.containerStore.getSnapshot()
            .nodes.find((node) => node.id === after.containerId);
          expect(destination?.systemSlot).toBe(current().trashSlot);
        }, WAIT_OPTIONS);
      }
    } finally {
      await act(async () => {
        release.resolve();
        await pending;
      });
    }
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
