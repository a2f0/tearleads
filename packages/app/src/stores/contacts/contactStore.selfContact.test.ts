import { expect, test } from "bun:test";
import type { UserKey } from "@tearleads/client-sdk";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentStore,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import {
  type ContactsRuntime,
  createContactsStore,
  getSelfContactLocalId,
} from "./contactStore";

const CONTACTS_CONTAINER_ID = "builtin-contacts-container";
const TRASH_CONTAINER_ID = "builtin-trash-container";

async function createContactsRuntime(): Promise<
  ContactsRuntime & { close: () => void }
> {
  const runtimeBase = await createSqlRuntimeBase(
    "contacts-store-self-contact-test",
  );
  const { close, ...runtimeInputBase } = runtimeBase;
  const documents = createDocumentsWorkflowRuntime({
    ...runtimeInputBase,
    apiClient: createMockApiClient(),
    auth: {
      ...runtimeInputBase.auth,
      userId: "self-user",
    },
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
        execSql: runtimeInputBase.infra.execSql,
        localId,
        persistence: defaultDocumentsPersistence,
      });
      return true;
    },
    documents,
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
    trashContainerId: TRASH_CONTAINER_ID,
  };
}

test("contacts store promotes a deferred self contact on later ensure", async () => {
  const baseRuntime = await createContactsRuntime();
  const structuredFieldDeferOptions: Array<boolean | undefined> = [];
  const runtime: ContactsRuntime & { close: () => void } = {
    ...baseRuntime,
    openDocumentStore: (input) => {
      const documentStore = baseRuntime.openDocumentStore(input);
      return {
        ...documentStore,
        setStructuredFields: async (kind, patch, options) => {
          structuredFieldDeferOptions.push(options?.deferRemoteSync);
          return documentStore.setStructuredFields(kind, patch, options);
        },
      };
    },
  };
  const selfKey: UserKey = {
    encapsulationPublicKey: "self-encapsulation-public-key",
    signingKeyFingerprint: "self-signing-fingerprint",
    signingPublicKey: "self-signing-public-key",
    userId: "self-user",
  };
  const store = createContactsStore(runtime, {
    fetchUserKey: async () => {
      throw new Error("unexpected remote self key fetch");
    },
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

    const selfContactId = getSelfContactLocalId(selfKey.signingKeyFingerprint);
    await store.ensureSelfContact({
      deferRemoteSync: true,
      encapsulationPublicKey: selfKey.encapsulationPublicKey,
      localId: selfContactId,
      userId: selfKey.userId,
    });
    expect(structuredFieldDeferOptions).toEqual([true]);

    await store.ensureSelfContact({
      encapsulationPublicKey: selfKey.encapsulationPublicKey,
      localId: selfContactId,
      userId: selfKey.userId,
    });
    expect(structuredFieldDeferOptions).toEqual([true, false]);
  } finally {
    runtime.close();
  }
});
