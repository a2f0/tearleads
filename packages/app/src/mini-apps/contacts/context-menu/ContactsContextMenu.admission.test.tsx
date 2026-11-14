import { afterEach, expect, test } from "bun:test";
import {
  createDocumentsWorkflowRuntime,
  deriveStableDocumentId,
  openDocumentStore,
  defaultDocumentsPersistence as persistence,
} from "@tearleads/client-sdk";
import {
  createExecSql,
  type SqlArrayRow,
  type SqlRow,
} from "@tearleads/client-sdk/sqlite";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import {
  createMockApiClient,
  initTestSqliteDatabase,
} from "@tearleads/test-utils";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { createSqlRuntimeBase } from "../../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
import {
  type ContactsRuntime,
  createContactsStore,
} from "../../../stores/contacts/contactStore";
import type { CurrentSelfContactIdentity } from "../../../stores/contacts/currentSelfContactIdentity";
import type { SelfContactIdentitySource } from "../../../stores/contacts/currentSelfContactIdentityState";
import { getSelfContactLocalId } from "../../../stores/contacts/selfContact";
import { useSelfContactIdentitySource } from "../../../stores/contacts/useSelfContactIdentitySource";
import {
  type ContactsContextMenuModel,
  useContactsContextMenu,
} from "./ContactsContextMenu";

afterEach(cleanup);

const CONTACTS = "builtin-contacts-container";
const TRASH = "builtin-trash-container";
const DATABASE_KEY = "contacts-menu-removal-admission-test";

async function createRemovalFixture() {
  const { close: closeDatabase, ...base } =
    await createSqlRuntimeBase(DATABASE_KEY);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    closeDatabase();
  };
  try {
    const sql = base.infra.execSql;
    const databases = await sql("PRAGMA database_list");
    const { file: dbName } =
      databases.find(({ name }) => name === "main") ?? {};
    if (typeof dbName !== "string" || !dbName)
      throw new Error("Expected a named SQLite test database");
    const documents = createDocumentsWorkflowRuntime({
      ...base,
      apiClient: createMockApiClient(),
      auth: { ...base.auth, userId: "self-user" },
      infra: {
        ...base.infra,
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      },
      state: { ...base.state, containerId: CONTACTS },
    });
    const moved: string[] = [];
    // Same real persistence ports as contactStore.removeContact.test.ts.
    const runtime: ContactsRuntime = {
      documents,
      listPendingWrites: async () => [],
      loadDocumentSummary: async (localId) => {
        const summaries =
          await persistence.listDocumentsByContainerIdsOrDocumentIds(sql, {
            containerIds: [CONTACTS],
            documentIds: [],
          });
        return summaries.find((summary) => summary.id === localId) ?? null;
      },
      moveDocumentToTrash: async (note, trashContainerId) => {
        moved.push(note.id);
        const existing = await persistence.loadDocument(sql, note.id);
        if (!existing) throw new Error("Contact document was not persisted");
        return persistence.relinkPersistedDocument(sql, {
          accessEpoch: existing.accessEpoch,
          containerId: trashContainerId,
          documentId: note.documentId,
          localId: note.id,
        });
      },
      openDocumentStore: (input) =>
        openDocumentStore(
          documents.state.domainScope,
          input.localId,
          documents,
          input.documentId ?? null,
          input.initialText,
          input.initialDocumentKind,
          { initialStructuredFields: input.initialStructuredFields },
        ),
      resolveTrashContainerForDocument: async () => ({
        status: "target",
        trashContainerId: TRASH,
      }),
    };
    const store = createContactsStore(runtime, {
      resolveVerified: async () => null,
      logError: (message, cause) => {
        throw new Error(String(message), { cause });
      },
    });
    return {
      close,
      moved,
      runtime,
      sql,
      store,
      async reopen(contactId: string) {
        // Reopen the actual named WASM-VFS database, not a copied snapshot.
        // This is process-local persistence, NOT OPFS or restart durability.
        close();
        const db = await initTestSqliteDatabase({
          dbName,
          cipher: "chacha20",
          key: DATABASE_KEY,
        });
        try {
          const reopenedSql = createExecSql({
            exec: async (options) => ({
              rows: execDatabaseStatement(db, options) as Array<
                SqlRow | SqlArrayRow
              >,
            }),
          });
          return {
            document: await persistence.loadDocument(reopenedSql, contactId),
            history: await persistence.loadHistoryRestoreState(
              reopenedSql,
              contactId,
            ),
          };
        } finally {
          db.close();
        }
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

type RemovalFixture = Awaited<ReturnType<typeof createRemovalFixture>>;

async function refreshableIdentity() {
  const localId = getSelfContactLocalId("contacts-menu-admission");
  const identity: CurrentSelfContactIdentity = {
    documentId: await deriveStableDocumentId(localId),
    localId,
    localIds: new Set([localId]),
  };
  let read = Promise.resolve(identity);
  let listener: () => void = () => undefined;
  let onLoad: () => void = () => undefined;
  const source: SelfContactIdentitySource = {
    enabled: true,
    isCurrent: () => true,
    load: () => {
      onLoad();
      return read;
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = () => undefined;
      };
    },
  };
  return {
    identity,
    source,
    refresh(next: Promise<CurrentSelfContactIdentity>) {
      const entered = Promise.withResolvers<void>();
      read = next;
      onLoad = entered.resolve;
      listener();
      return entered.promise;
    },
  };
}

function AdmissionMenuHarness(input: {
  caller: { version: number };
  contactId: string;
  fixture: RemovalFixture;
  onModel: (model: ContactsContextMenuModel) => void;
  source: SelfContactIdentitySource;
}) {
  const { runtime, store } = input.fixture;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const identity = useSelfContactIdentitySource(input.source);
  const version = input.caller.version;
  const model = useContactsContextMenu({
    canWrite: true,
    entries: snapshot.entries,
    // Mirror the bound consumer: preserve its runtime and forward the actual
    // menu authority, never substituting a fake downstream identity guard.
    removeContact: (contactId, operation) =>
      store.removeContact(contactId, {
        runtime,
        isCurrent: () =>
          input.caller.version === version && (operation?.isCurrent() ?? true),
        runWhenCurrent: operation?.runWhenCurrent,
      }),
    selectedContactId: input.contactId,
    selfContactIdentity: identity,
    setSelectedContactId: () => undefined,
  });
  input.onModel(model);
  return (
    <>
      <button
        type="button"
        onContextMenu={(event) =>
          model.handleSidebarContextMenu(event, input.contactId)
        }
      >
        Contact
      </button>
      <output aria-label="Can remove">
        {model.canRemoveContextMenuContact ? "yes" : "no"}
      </output>
    </>
  );
}

function renderRemovalMenu(
  fixture: RemovalFixture,
  source: SelfContactIdentitySource,
  contactId: string,
  caller = { version: 0 },
) {
  let remove: () => Promise<void> = async () => {
    throw new Error("Menu not mounted");
  };
  const harness = (id: string) => (
    <AdmissionMenuHarness
      caller={caller}
      contactId={id}
      fixture={fixture}
      onModel={(model) => {
        remove = model.removeContextMenuContact;
      }}
      source={source}
    />
  );
  const view = render(harness(contactId));
  return {
    ...view,
    caller,
    open(id: string) {
      view.rerender(harness(id));
      fireEvent.contextMenu(view.getByRole("button", { name: "Contact" }));
    },
    remove: () => remove(),
    canRemove: () => view.getByLabelText("Can remove").textContent,
  };
}

async function createContact(fixture: RemovalFixture) {
  const id = await fixture.store.createContact({
    firstName: "Ordinary",
    lastName: "Contact",
  });
  if (!id) throw new Error("Contact creation returned no id");
  await waitForCondition(
    () => fixture.store.getSnapshot().entries.some((entry) => entry.id === id),
    "Contact did not appear in the store snapshot",
  );
  return id;
}

function holdSummary(fixture: RemovalFixture) {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const load = fixture.runtime.loadDocumentSummary;
  fixture.runtime.loadDocumentSummary = async (localId) => {
    const summary = await load(localId);
    entered.resolve();
    await release.promise;
    return summary;
  };
  return { entered, release };
}

async function startHeldRemoval(
  menu: ReturnType<typeof renderRemovalMenu>,
  held: ReturnType<typeof holdSummary>,
  start: () => Promise<void>,
) {
  await waitFor(() => expect(menu.canRemove()).toBe("yes"));
  await act(async () => {
    const pending = start();
    await Promise.race([
      held.entered.promise,
      pending.then(() => {
        throw new Error("Removal did not reach the held summary read");
      }),
    ]);
  });
}

for (const changed of [false, true]) {
  const outcome = changed
    ? "a recovery alias and refuses"
    : "equivalent metadata and proceeds";
  test(`prepared contact removal waits for ${outcome}`, async () => {
    const metadata = await refreshableIdentity();
    const fixture = await createRemovalFixture();
    const held = holdSummary(fixture);
    const refresh = Promise.withResolvers<CurrentSelfContactIdentity>();
    let refreshed = metadata.identity;
    let pending: Promise<void> | undefined;
    let menu: ReturnType<typeof renderRemovalMenu> | undefined;
    try {
      fixture.store.updateRuntime(fixture.runtime);
      const id = await createContact(fixture);
      const freshId = await createContact(fixture);
      const before = await persistence.loadDocument(fixture.sql, id);
      const history = await persistence.loadHistoryRestoreState(
        fixture.sql,
        id,
      );
      expect(before).toMatchObject({ containerId: CONTACTS, documentId: null });
      expect(history).not.toBeNull();
      menu = renderRemovalMenu(fixture, metadata.source, id);
      const currentMenu = menu;
      currentMenu.open(id);
      let settled = false;
      await startHeldRemoval(currentMenu, held, () => {
        pending = currentMenu.remove().then(() => {
          settled = true;
        });
        return pending;
      });
      // This is an already-admitted metadata result, not a test of authority
      // to convert an ordinary contact into the canonical self document.
      refreshed = {
        ...metadata.identity,
        localIds: new Set([
          ...metadata.identity.localIds,
          ...(changed ? [id] : []),
        ]),
      };
      await act(async () => {
        await metadata.refresh(refresh.promise);
      });
      await act(async () => {
        held.release.resolve();
        await held.release.promise;
      });
      expect(fixture.moved).toEqual([]);
      expect(settled).toBe(false);
      await act(async () => {
        refresh.resolve(refreshed);
        await pending;
      });
      expect(fixture.moved).toEqual(changed ? [] : [id]);
      const persisted = await persistence.loadDocument(fixture.sql, id);
      if (changed) {
        expect(persisted).toEqual(before);
        expect(
          fixture.store.getSnapshot().entries.some((entry) => entry.id === id),
        ).toBe(true);
        currentMenu.open(id);
        expect(currentMenu.canRemove()).toBe("no");
      } else {
        expect(persisted?.containerId).toBe(TRASH);
      }
      // A fresh action on another ordinary contact still works under the
      // current identity; neither branch may blanket-disable removal.
      currentMenu.open(freshId);
      expect(currentMenu.canRemove()).toBe("yes");
      await act(async () => {
        await currentMenu.remove();
      });
      expect(fixture.moved).toEqual(changed ? [freshId] : [id, freshId]);
      expect(
        (await persistence.loadDocument(fixture.sql, freshId))?.containerId,
      ).toBe(TRASH);
      const reopened = await fixture.reopen(id);
      expect(reopened.document).toEqual(persisted);
      expect(reopened.history).toEqual(history);
    } finally {
      try {
        await act(async () => {
          held.release.resolve();
          refresh.resolve(refreshed);
          await Promise.allSettled([refresh.promise, pending]);
        });
      } finally {
        menu?.unmount();
        fixture.close();
      }
    }
  });
}

test.each(["caller", "store"] as const)(
  "a %s runtime ABA refuses stale removal but permits a fresh action",
  async (boundary) => {
    const metadata = await refreshableIdentity();
    const fixture = await createRemovalFixture();
    const held = holdSummary(fixture);
    let pending: Promise<void> | undefined;
    let menu: ReturnType<typeof renderRemovalMenu> | undefined;
    try {
      fixture.store.updateRuntime(fixture.runtime);
      const id = await createContact(fixture);
      const before = await persistence.loadDocument(fixture.sql, id);
      menu = renderRemovalMenu(fixture, metadata.source, id);
      const currentMenu = menu;
      currentMenu.open(id);
      await startHeldRemoval(currentMenu, held, () => {
        pending = currentMenu.remove();
        return pending;
      });
      if (boundary === "caller") {
        currentMenu.caller.version = 1;
        currentMenu.caller.version = 2;
      } else {
        fixture.store.updateRuntime({
          ...fixture.runtime,
          documents: {
            ...fixture.runtime.documents,
            auth: { ...fixture.runtime.documents.auth, userId: null },
          },
        });
        fixture.store.updateRuntime(fixture.runtime);
      }
      await act(async () => {
        held.release.resolve();
        await pending;
      });
      expect(fixture.moved).toEqual([]);
      expect(await persistence.loadDocument(fixture.sql, id)).toEqual(before);
      currentMenu.open(id);
      expect(currentMenu.canRemove()).toBe("yes");
      await act(async () => {
        await currentMenu.remove();
      });
      expect(fixture.moved).toEqual([id]);
      expect((await fixture.reopen(id)).document?.containerId).toBe(TRASH);
    } finally {
      try {
        await act(async () => {
          held.release.resolve();
          await Promise.allSettled([pending]);
        });
      } finally {
        menu?.unmount();
        fixture.close();
      }
    }
  },
);
