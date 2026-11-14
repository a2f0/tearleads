import { expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import {
  createRecoveryContactsRuntime,
  seedDuplicateSelfContacts,
  setPersistedContactDocumentIdentity,
} from "../../../test/helpers/contactStoreRecovery";
import {
  item,
  operation,
} from "../../../test/helpers/explorer/syncPanelFixtures";
import { createContactsStore } from "./contactStore";

test("placement introduced on reconnect refuses Me maintenance without touching either stream", async () => {
  const base = await createRecoveryContactsRuntime({
    runtimeKey: "contacts-placement-reconnect",
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicateSelfContacts(base);
  const documentId = await deriveStableDocumentId(localId);
  const errors: unknown[] = [];
  const store = createContactsStore(base, {
    resolveVerified: async () => null,
    logError: (message, cause) => errors.push({ message, cause }),
  });
  const histories = () =>
    Promise.all(
      [localId, "recovered-self"].map((id) =>
        defaultDocumentsPersistence.loadHistoryRestoreState(
          base.documents.infra.execSql,
          id,
        ),
      ),
    );
  try {
    await setPersistedContactDocumentIdentity(base, localId, documentId);
    await setPersistedContactDocumentIdentity(
      base,
      "recovered-self",
      await deriveStableDocumentId("recovered-self"),
    );
    store.updateRuntime(base);
    expect(
      await store.ensureSelfContact({
        localId,
        userId: "self-user",
        encapsulationPublicKey: "self-key",
        deferRemoteSync: true,
      }),
    ).toBe(localId);
    const before = await histories();
    expect(before.every((history) => history !== null)).toBe(true);
    store.updateRuntime({
      ...base,
      documents: {
        ...base.documents,
        state: { ...base.documents.state, online: true },
      },
      listPendingWrites: async () => [
        item({
          localId,
          remoteId: documentId,
          operations: [operation({ kind: "move" })],
        }),
      ],
    });
    expect(
      await store.ensureSelfContact({
        localId,
        userId: "self-user",
        encapsulationPublicKey: "changed-key",
        deferRemoteSync: true,
      }),
    ).toBeNull();
    expect(await histories()).toEqual(before);
    expect(errors).toEqual([]);
  } finally {
    store.updateRuntime({
      ...base,
      documents: {
        ...base.documents,
        infra: { ...base.documents.infra, dbStatus: "terminated" },
      },
    });
    base.close();
  }
});
