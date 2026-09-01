import { expect, test } from "bun:test";
import {
  createDocumentsWorkflowRuntime,
  type DocumentSummary,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentStore,
  subscribeToPersistedDocuments,
} from "@tearleads/client-sdk";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
} from "@tearleads/client-sdk/sqlite";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

const CONTACTS_CONTAINER_ID = "persisted-contacts-container";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

async function createPersistedContactsRuntime(): Promise<
  ContactsRuntime & { close: () => void }
> {
  const runtimeBase = await createSqlRuntimeBase(
    "contacts-store-persisted-documents-test",
  );
  const { close, ...runtimeInputBase } = runtimeBase;
  const documents = createDocumentsWorkflowRuntime({
    ...runtimeInputBase,
    apiClient: createMockApiClient(),
    infra: {
      ...runtimeInputBase.infra,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    },
    state: {
      ...runtimeInputBase.state,
      containerId: CONTACTS_CONTAINER_ID,
    },
  });

  return {
    close,
    deleteDocument: async (localId) => {
      await deletePersistedDocument({
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
        execSql: documents.infra.execSql,
        localId,
        persistence: defaultDocumentsPersistence,
      });
      return true;
    },
    documents,
    loadDocumentSummary: () => Promise.resolve(null),
    moveDocumentToTrash: () => Promise.resolve(null),
    openDocumentStore: (input) =>
      openDocumentStore(
        documents.state.domainScope,
        input.localId,
        documents,
        input.documentId ?? null,
        input.initialText,
        input.initialDocumentKind,
      ),
    subscribeToPersistedDocuments: (listener) =>
      subscribeToPersistedDocuments(documents.state.domainScope, listener),
  };
}

function withContactsContainer(
  runtime: ContactsRuntime,
  containerId: string,
  execSql: ExecSql = runtime.documents.infra.execSql,
): ContactsRuntime {
  const documents = {
    ...runtime.documents,
    infra: { ...runtime.documents.infra, execSql },
    state: { ...runtime.documents.state, containerId },
  };

  return {
    ...runtime,
    documents,
    openDocumentStore: (input) =>
      openDocumentStore(
        documents.state.domainScope,
        input.localId,
        documents,
        input.documentId ?? null,
        input.initialText,
        input.initialDocumentKind,
      ),
  };
}

async function persistContact(
  runtime: ContactsRuntime,
  contactId: string,
  firstName: string,
): Promise<void> {
  const contact = runtime.openDocumentStore({
    containerId: runtime.documents.state.containerId,
    initialDocumentKind: "contact",
    localId: contactId,
  });
  await contact.setStructuredFields("contact", { firstName });
}

test("contacts store observes a contact persisted after initialization", async () => {
  const runtime = await createPersistedContactsRuntime();
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );
    expect(store.getSnapshot().entries).toEqual([]);

    const recoveredContact = runtime.openDocumentStore({
      containerId: CONTACTS_CONTAINER_ID,
      initialDocumentKind: "contact",
      localId: "recovered-contact",
    });
    await recoveredContact.setStructuredFields("contact", {
      firstName: "Grace",
      lastName: "Hopper",
    });

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .entries.some(
            (entry) =>
              entry.id === "recovered-contact" &&
              entry.firstName === "Grace" &&
              entry.lastName === "Hopper",
          ),
      "Late-persisted contact did not enter the Contacts snapshot.",
    );
  } finally {
    runtime.close();
  }
});

test("runtime resets replace and release the persisted-document subscription", async () => {
  const runtime = await createPersistedContactsRuntime();
  let activeSubscriptions = 0;
  let subscriptionCount = 0;
  let unsubscribeCount = 0;
  const persistedDocumentListeners: Array<(document: DocumentSummary) => void> =
    [];
  const lifecycleCounts = () => ({
    activeSubscriptions,
    subscriptionCount,
    unsubscribeCount,
  });
  const trackedRuntime: ContactsRuntime = {
    ...runtime,
    subscribeToPersistedDocuments: (listener) => {
      activeSubscriptions += 1;
      subscriptionCount += 1;
      persistedDocumentListeners.push(listener);
      let active = true;
      return () => {
        if (!active) {
          throw new Error("Persisted-document subscription disposed twice.");
        }
        active = false;
        activeSubscriptions -= 1;
        unsubscribeCount += 1;
      };
    },
  };
  const store = createContactsStore(trackedRuntime, {
    resolveUserIdentity: async () => null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });
  const nextRuntime = withContactsContainer(
    trackedRuntime,
    "replacement-contacts-container",
  );
  await persistContact(nextRuntime, "replacement-contact", "Replacement");
  const idleRuntime: ContactsRuntime = {
    ...nextRuntime,
    documents: {
      ...nextRuntime.documents,
      infra: { ...nextRuntime.documents.infra, dbStatus: "idle" },
    },
  };

  try {
    expect(lifecycleCounts()).toEqual({
      activeSubscriptions: 1,
      subscriptionCount: 1,
      unsubscribeCount: 0,
    });

    const staleListener = persistedDocumentListeners[0];
    if (!staleListener) {
      throw new Error("Initial persisted-document listener was not captured.");
    }
    staleListener({
      containerId: CONTACTS_CONTAINER_ID,
      documentKind: "contact",
      documentId: null,
      id: "replacement-contact",
      title: "Replacement",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });

    store.updateRuntime(nextRuntime);
    expect(lifecycleCounts()).toEqual({
      activeSubscriptions: 1,
      subscriptionCount: 2,
      unsubscribeCount: 1,
    });
    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .entries.some((entry) => entry.id === "replacement-contact"),
      "Replacement Contacts container did not initialize.",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      store
        .getSnapshot()
        .entries.some((entry) => entry.id === "replacement-contact"),
    ).toBe(true);

    store.updateRuntime(nextRuntime);
    expect(lifecycleCounts()).toEqual({
      activeSubscriptions: 1,
      subscriptionCount: 2,
      unsubscribeCount: 1,
    });

    store.updateRuntime(idleRuntime);
    expect(lifecycleCounts()).toEqual({
      activeSubscriptions: 0,
      subscriptionCount: 2,
      unsubscribeCount: 2,
    });
  } finally {
    store.updateRuntime(idleRuntime);
    runtime.close();
  }
});

test("stale local initialization cannot overwrite a rematerialized Contacts container", async () => {
  const runtime = await createPersistedContactsRuntime();
  const localRuntime = withContactsContainer(
    runtime,
    "local-contacts-container",
  );
  const remoteRuntime = withContactsContainer(
    runtime,
    "remote-contacts-container",
  );
  await persistContact(localRuntime, "local-contact", "Local");
  await persistContact(remoteRuntime, "remote-contact", "Remote");

  const localLoadStarted = createDeferred();
  const releaseLocalLoad = createDeferred();
  const localProjectionReadFinished = createDeferred();
  const baseExecSql = localRuntime.documents.infra.execSql;
  const gatedClient: ExecSqlClientLike = {
    exec: async ({ sql, bind, rowMode }) => {
      localLoadStarted.resolve();
      await releaseLocalLoad.promise;
      const rows =
        rowMode === "array"
          ? await baseExecSql(sql, bind, { rowMode: "array" })
          : await baseExecSql(sql, bind, { rowMode: "object" });
      if (
        sql.toLowerCase().startsWith("select") &&
        sql.includes("contact_projection")
      ) {
        localProjectionReadFinished.resolve();
      }
      return { rows };
    },
  };
  const delayedLocalRuntime = withContactsContainer(
    localRuntime,
    "local-contacts-container",
    createExecSql(gatedClient),
  );
  const store = createContactsStore(delayedLocalRuntime, {
    resolveUserIdentity: async () => null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(delayedLocalRuntime);
    await localLoadStarted.promise;

    store.updateRuntime(remoteRuntime);
    await waitForCondition(
      () =>
        store.getSnapshot().ready &&
        store
          .getSnapshot()
          .entries.some((entry) => entry.id === "remote-contact"),
      "Remote Contacts container did not initialize.",
    );

    releaseLocalLoad.resolve();
    await localProjectionReadFinished.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getSnapshot().entries.map((entry) => entry.id)).toEqual([
      "remote-contact",
    ]);
  } finally {
    releaseLocalLoad.resolve();
    runtime.close();
  }
});

test("same-container runtime refresh does not abandon an in-flight initialization", async () => {
  const runtime = await createPersistedContactsRuntime();
  await persistContact(runtime, "stable-contact", "Stable");

  const loadStarted = createDeferred();
  const releaseLoad = createDeferred();
  const baseExecSql = runtime.documents.infra.execSql;
  const delayedExecSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      loadStarted.resolve();
      await releaseLoad.promise;
      const rows =
        rowMode === "array"
          ? await baseExecSql(sql, bind, { rowMode: "array" })
          : await baseExecSql(sql, bind, { rowMode: "object" });
      return { rows };
    },
  });
  const initialRuntime = withContactsContainer(
    runtime,
    CONTACTS_CONTAINER_ID,
    delayedExecSql,
  );
  const refreshedRuntime = withContactsContainer(
    initialRuntime,
    CONTACTS_CONTAINER_ID,
    delayedExecSql,
  );
  const store = createContactsStore(initialRuntime, {
    resolveUserIdentity: async () => null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(initialRuntime);
    await loadStarted.promise;
    store.updateRuntime(refreshedRuntime);
    releaseLoad.resolve();

    await waitForCondition(
      () =>
        store.getSnapshot().ready &&
        store
          .getSnapshot()
          .entries.some((entry) => entry.id === "stable-contact"),
      "Same-container runtime refresh abandoned Contacts initialization.",
    );
  } finally {
    releaseLoad.resolve();
    runtime.close();
  }
});
