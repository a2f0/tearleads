import { expect, test } from "bun:test";
import {
  createDocumentStore,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  type ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import {
  CONTACTS_CONTAINER_ID,
  createRecoveryContactsRuntime,
} from "../../../test/helpers/contactStoreRecovery";
import { createContactsStore } from "./contactStore";

const PEER: ResolvedUserIdentity = {
  encapsulationKeyFingerprint: "shell-peer-kem-fingerprint",
  encapsulationPublicKey: "shell-peer-kem-key",
  signingKeyFingerprint: "shell-peer-signing-fingerprint",
  signingPublicKey: "shell-peer-signing-key",
  userId: "shell-peer-user",
};

async function setup(
  runtimeKey: string,
  shell: { containerId?: string; effectiveAccessLevel?: "read" | "write" },
) {
  const runtime = await createRecoveryContactsRuntime({
    runtimeKey,
    signingFingerprint: "shell-owner-signing",
    userId: "shell-owner-user",
  });
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    logError: (message, cause) => errors.push({ message, cause }),
    resolveVerified: async () => PEER,
  });
  const execSql = runtime.documents.infra.execSql;
  // Another device's import of the same peer births at this fixed id; here
  // only its discovery shell exists, under a different local id.
  const fixedLocalId = `contact_v1_${CONTACTS_CONTAINER_ID}_${PEER.userId}`;
  const documentId = await deriveStableDocumentId(fixedLocalId);
  const containerId = shell.containerId ?? CONTACTS_CONTAINER_ID;
  await defaultDocumentsPersistence.upsertDiscoveredDocument(execSql, {
    accessEpoch: 1,
    containerId,
    createdAt: "2026-11-01T00:00:00.000Z",
    documentId,
    effectiveAccessLevel: shell.effectiveAccessLevel ?? "write",
    linkedContainerIds: [containerId],
  });
  const shellLocalId =
    await defaultDocumentsPersistence.findLocalIdByDocumentId(
      execSql,
      documentId,
    );
  if (!shellLocalId || shellLocalId === fixedLocalId)
    throw new Error("Discovery did not create a distinct shell");
  const before = await defaultDocumentsPersistence.loadDocument(
    execSql,
    shellLocalId,
  );
  store.updateRuntime(runtime);
  return {
    before,
    documentId,
    errors,
    execSql,
    fixedLocalId,
    runtime,
    shellLocalId,
    store,
  };
}

test("peer import completes a discovered shell of the same remote history", async () => {
  const {
    documentId,
    errors,
    execSql,
    fixedLocalId,
    runtime,
    shellLocalId,
    store,
  } = await setup("contact-import-discovered-shell", {});
  try {
    expect(await store.importVerifiedUser(PEER.userId)).toBe(shellLocalId);
    expect(await store.importVerifiedUser(PEER.userId)).toBe(shellLocalId);
    expect(
      (await defaultDocumentsPersistence.listDocuments(execSql)).map(
        (record) => record.id,
      ),
    ).toEqual([shellLocalId]);
    expect(
      await defaultDocumentsPersistence.loadDocument(execSql, fixedLocalId),
    ).toBeNull();
    const reopened = createDocumentStore(
      shellLocalId,
      runtime.documents,
      defaultDocumentsPersistence,
      documentId,
    );
    expect(await reopened.ensureInitialized()).toBe(true);
    expect(reopened.getSnapshot()).toMatchObject({
      documentId,
      structuredFields: {
        encapsulationPublicKey: PEER.encapsulationPublicKey,
        userId: PEER.userId,
      },
    });
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
  }
});

for (const [name, shell] of [
  ["read-only", { effectiveAccessLevel: "read" }],
  ["out-of-place", { containerId: "other-contacts-container" }],
] as const) {
  test(`peer import refuses a ${name} discovered shell without writing`, async () => {
    const { before, execSql, fixedLocalId, runtime, shellLocalId, store } =
      await setup(`contact-import-${name}-shell`, shell);
    try {
      expect(await store.importVerifiedUser(PEER.userId)).toBeNull();
      expect(
        await defaultDocumentsPersistence.loadDocument(execSql, shellLocalId),
      ).toEqual(before);
      expect(
        await defaultDocumentsPersistence.loadDocument(execSql, fixedLocalId),
      ).toBeNull();
    } finally {
      runtime.close();
    }
  });
}
