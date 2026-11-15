import { expect, spyOn, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import { createRecoveryContactsRuntime } from "../../../test/helpers/contactStoreRecovery";
import { loadSelfContactSelection } from "./contactStoreSelfSelection";
import type { ContactsStoreState } from "./contactStoreTypes";
import { getSelfContactLocalId } from "./selfContact";

async function selectionFixture(existing: boolean) {
  const fingerprint = `bounded-self-selection-${existing}`;
  const runtime = await createRecoveryContactsRuntime({
    runtimeKey: fingerprint,
    signingFingerprint: fingerprint,
    userId: "selection-user",
  });
  const localId = getSelfContactLocalId(fingerprint);
  const documentId = await deriveStableDocumentId(localId);
  const ids = Array.from({ length: 16 }, (_, index) => `unrelated-${index}`);
  if (existing) ids.push(localId);
  for (const id of ids) {
    const document = runtime.openDocumentStore({
      localId: id,
      initialDocumentKind: "contact",
      initialStructuredFields: { firstName: id },
    });
    expect(await document.ensureInitialized()).toBe(true);
  }
  const state: ContactsStoreState = {
    authorityGeneration: 0,
    contactDocumentStoresById: new Map(),
    dependencies: {
      logError: () => {},
      resolveVerified: async () => null,
    },
    entriesById: new Map(),
    initializationGeneration: 0,
    initializePromise: null,
    initialized: false,
    listeners: new Set(),
    pendingSnapshotFlush: false,
    persistedDocumentsUnsubscribe: null,
    runtime,
    snapshot: { entries: [], ready: false },
    writeChain: Promise.resolve(),
  };
  return {
    close: runtime.close,
    identity: {
      documentId,
      encapsulationPublicKey: null,
      localId,
      userId: "selection-user",
    },
    state,
  };
}

test.each([true, false])(
  "self selection never loads unrelated contact records (existing=%s)",
  async (existing) => {
    const fixture = await selectionFixture(existing);
    const load = spyOn(defaultDocumentsPersistence, "loadDocument");
    try {
      expect(
        await loadSelfContactSelection(
          fixture.state,
          fixture.identity,
          () => true,
        ),
      ).toEqual({
        status: existing ? "existing" : "create",
        contactId: fixture.identity.localId,
      });
      expect(
        load.mock.calls
          .map(([, id]) => id)
          .filter((id) => id.startsWith("unrelated-")),
      ).toEqual([]);
      expect(load.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      load.mockRestore();
      fixture.close();
    }
  },
);
