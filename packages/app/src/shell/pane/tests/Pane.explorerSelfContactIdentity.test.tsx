import { afterEach, expect, spyOn, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  type Tearleads,
} from "@tearleads/client-sdk";
import { WindowStateProvider } from "@tearleads/windowing";
import { act, waitFor } from "@testing-library/react";
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
import { useExplorerModel } from "../../../mini-apps/explorer/hooks/useExplorerModel";
import { MINI_APP_LAUNCHER } from "../../../mini-apps/registry";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import {
  ContactsProvider,
  useContacts,
} from "../../../stores/contacts/ContactsProvider";
import { getSelfContactLocalId } from "../../../stores/contacts/selfContact";
import {
  ExplorerProvider,
  useExplorer,
} from "../../../stores/explorer/ExplorerProvider";

const WAIT_OPTIONS = { timeout: PANE_ASYNC_TEST_TIMEOUT_MS };
const ignoreDatabaseRetry = () => undefined;
afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

type Capture = {
  contacts: ReturnType<typeof useContacts>;
  model: ReturnType<typeof useExplorerModel>;
  sdk: Tearleads;
};

function captureExplorerModel() {
  const captured: { current: Capture | null } = { current: null };
  function Probe() {
    const sdk = useTearleads();
    const contacts = useContacts();
    const appData = useTearleadsRuntime();
    const explorer = useExplorer();
    const [sidebar, setSidebar] = useState<ReactNode>(null);
    const model = useExplorerModel(
      appData,
      explorer,
      setSidebar,
      false,
      null,
      ignoreDatabaseRetry,
    );
    useLayoutEffect(() => {
      captured.current = { contacts, model, sdk };
    }, [contacts, model, sdk]);
    return <section aria-label="Identity Explorer probe">{sidebar}</section>;
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
            <ExplorerProvider showBuiltInSystemContainers>
              <ContactsProvider>
                <Probe />
              </ContactsProvider>
            </ExplorerProvider>
          </MiniAppBusProvider>
        </AppNavigationProvider>
      </WindowStateProvider>
    ),
  });
  return {
    view,
    current: () => {
      invariant(captured.current, "Explorer model was not committed");
      return captured.current;
    },
  };
}

function observeDocumentEffects(sdk: Tearleads) {
  const calls: Array<{ kind: "move" | "purge"; id: string }> = [];
  const documentLinks = sdk.containerContents.documentLinks.bind(
    sdk.containerContents,
  );
  const observer = spyOn(
    sdk.containerContents,
    "documentLinks",
  ).mockImplementation(() => {
    const links = documentLinks();
    return {
      ...links,
      moveDocumentToContainer: (input) => {
        calls.push({ kind: "move", id: input.note.id });
        return links.moveDocumentToContainer(input);
      },
      purgeDocument: (input) => {
        calls.push({ kind: "purge", id: input.note.id });
        return links.purgeDocument(input);
      },
    };
  });
  return { calls, restore: () => observer.mockRestore() };
}

// Actual providers/model and call-through SDK effects, not a supplied identity
// port. Replacement coverage is same-database A-B-A, not an account switch.
test(
  "Explorer retains an ordinary delete across an unrelated document save",
  async () => {
    const { view, current } = captureExplorerModel();
    const sdk = current().sdk;
    const effects = observeDocumentEffects(sdk);
    try {
      await generateIdentityAndWaitForDb(view);
      await waitFor(() => {
        expect(current().model.explorer.ready).toBe(true);
        expect(current().contacts.ready).toBe(true);
      }, WAIT_OPTIONS);
      const sql = sdk.database.execSql;
      invariant(sql, "SQLite executor is missing");
      const ids: string[] = [];
      await act(async () => {
        for (const firstName of ["Target", "Unrelated"]) {
          const id = await current().contacts.createContact({ firstName });
          invariant(id, "Ordinary contact was not persisted");
          ids.push(id);
        }
      });
      const [id, otherId] = ids;
      invariant(id && otherId, "Missing ordinary contact IDs");
      const before = await defaultDocumentsPersistence.loadDocument(sql, id);
      invariant(before?.containerId, "Ordinary contact has no placement");
      const sourceContainerId = before.containerId;
      const unrelated = sdk.documents.open({
        localId: otherId,
        containerId: sourceContainerId,
      });
      expect(await unrelated.ensureInitialized()).toBe(true);
      // Keep destination provisioning outside this identity-refresh regression:
      // the retained action must already know the existing Trash node.
      await act(async () => {
        expect(
          await current().model.explorer.ensureTrashContainer(),
        ).not.toBeNull();
      });
      await waitFor(() => {
        const { explorer } = current().model;
        expect(
          explorer.nodes.some(
            (node) =>
              node.systemSlot != null &&
              node.systemSlot === explorer.trashSystemSlot,
          ),
        ).toBe(true);
      }, WAIT_OPTIONS);
      act(() =>
        current().model.selectDocumentProjection(id, sourceContainerId),
      );
      const retained = await waitFor(() => {
        const model = current().model;
        expect(model.selection.selectedDocument?.id).toBe(id);
        expect(model.canDeleteSelectedDocument).toBe(true);
        return model.deleteDocument;
      }, WAIT_OPTIONS);
      const version = sdk.runtime.version;
      await act(async () => {
        await unrelated.setStructuredFields("contact", {
          nickname: "Unrelated content save",
        });
      });
      expect(sdk.runtime.version).toBe(version);
      expect(unrelated.hasUnsavedLocalEdits()).toBe(false);
      await act(async () => {
        await retained(id, sourceContainerId);
      });
      expect(effects.calls).toEqual([{ kind: "move", id }]);
      const after = await defaultDocumentsPersistence.loadDocument(sql, id);
      invariant(after?.containerId, "Moved contact lost its durable record");
      expect(after.containerId).not.toBe(sourceContainerId);
      expect(
        current().model.explorer.nodes.find(
          (node) => node.id === after.containerId,
        )?.systemSlot,
      ).toBe(current().model.explorer.trashSystemSlot);
      expect(
        (await defaultDocumentsPersistence.loadDocument(sql, otherId))
          ?.containerId,
      ).toBe(sourceContainerId);
    } finally {
      effects.restore();
    }
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

test.each(["move", "purge"] as const)(
  "Explorer model retires a retained %s callback after database A-B-A",
  async (kind) => {
    const { view, current } = captureExplorerModel();
    const sdk = current().sdk;
    const effects = observeDocumentEffects(sdk);
    try {
      await generateIdentityAndWaitForDb(view);
      const selfId = getSelfContactLocalId(
        sdk.identity.signingFingerprint ?? "",
      );
      await waitFor(() => {
        expect(current().model.explorer.ready).toBe(true);
        expect(current().contacts.ready).toBe(true);
        expect(
          current().contacts.entries.some((entry) => entry.id === selfId),
        ).toBe(true);
      }, WAIT_OPTIONS);
      const database = sdk.database.snapshot;
      invariant(database.execSql, "SQLite executor is missing");
      const sql = database.execSql;
      const self = await defaultDocumentsPersistence.loadDocument(sql, selfId);
      invariant(self?.containerId, "Canonical Me has no persisted placement");
      const contactsContainerId = self.containerId;
      const created: { id: string | null } = { id: null };
      await act(async () => {
        created.id = await current().contacts.createContact({
          firstName: "Ordinary",
        });
      });
      invariant(created.id, "Ordinary contact was not persisted");
      const id = created.id;
      act(() =>
        current().model.selectDocumentProjection(id, contactsContainerId),
      );
      // Offline Explorer has no primary-org Contacts projection. An enabled
      // ordinary action, not its label/selected-self fallback, proves readiness.
      await waitFor(() => {
        expect(current().model.selection.selectedDocument?.id).toBe(id);
        expect(current().model.canDeleteSelectedDocument).toBe(true);
      }, WAIT_OPTIONS);
      await act(async () => {
        await current().model.deleteDocument(selfId, contactsContainerId);
      });
      expect(effects.calls).toEqual([]);
      expect(
        (await defaultDocumentsPersistence.loadDocument(sql, selfId))
          ?.containerId,
      ).toBe(contactsContainerId);
      if (kind === "purge") {
        await act(async () => {
          await current().model.deleteDocument(id, contactsContainerId);
        });
        expect(effects.calls).toEqual([{ kind: "move", id }]);
        effects.calls.length = 0;
      }
      const before = await defaultDocumentsPersistence.loadDocument(sql, id);
      invariant(
        before?.containerId,
        "Ordinary contact has no persisted placement",
      );
      const sourceContainerId = before.containerId;
      act(() =>
        current().model.selectDocumentProjection(id, sourceContainerId),
      );
      const captureEnabledAction = () => {
        const model = current().model;
        expect(model.selection.selectedDocument?.id).toBe(id);
        expect(
          kind === "move"
            ? model.canDeleteSelectedDocument
            : model.canPurgeSelectedDocument,
        ).toBe(true);
        return kind === "move" ? model.deleteDocument : model.purgeDocument;
      };
      // Capture from the same committed ready model: reading current() after
      // waitFor yields can instead capture a new, already-pending callback.
      const retained = await waitFor(captureEnabledAction, WAIT_OPTIONS);
      const version = sdk.runtime.version;
      await act(async () => {
        sdk.database.clear();
        sdk.database.configure(database);
        await retained(id, sourceContainerId);
      });
      expect(sdk.runtime.version).toBeGreaterThan(version);
      expect(sdk.database.execSql).toBe(sql);
      // Observe the model boundary even if a lower SDK guard refuses a call.
      expect(effects.calls).toEqual([]);
      expect(await defaultDocumentsPersistence.loadDocument(sql, id)).toEqual(
        before,
      );
      // Replacing the database can reset Explorer navigation. A fresh user
      // action reselects the preserved document; old view retention is not
      // this test's contract.
      await waitFor(
        () => expect(current().model.explorer.ready).toBe(true),
        WAIT_OPTIONS,
      );
      act(() =>
        current().model.selectDocumentProjection(id, sourceContainerId),
      );
      const fresh = await waitFor(captureEnabledAction, WAIT_OPTIONS);
      await act(async () => {
        await fresh(id, sourceContainerId);
      });
      expect(effects.calls).toEqual([{ kind, id }]);
      const after = await defaultDocumentsPersistence.loadDocument(sql, id);
      if (kind === "move") {
        invariant(after?.containerId, "Moved contact lost its durable record");
        expect(after.containerId).not.toBe(sourceContainerId);
        const target = current().model.explorer.nodes.find(
          (node) => node.id === after.containerId,
        );
        expect(target?.systemSlot).toBe(
          current().model.explorer.trashSystemSlot,
        );
      } else {
        expect(after).toBeNull();
      }
      expect(
        await defaultDocumentsPersistence.loadDocument(sql, selfId),
      ).not.toBeNull();
    } finally {
      effects.restore();
    }
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
