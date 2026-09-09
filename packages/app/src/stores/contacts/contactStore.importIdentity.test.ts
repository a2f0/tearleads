import { expect, test } from "bun:test";
import { defaultDocumentsPersistence } from "@tearleads/client-sdk";
import { createRecoveryContactsRuntime } from "../../../test/helpers/contactStoreRecovery";
import { createContactsStore } from "./contactStore";

test("contact imports retain identity across fresh devices and isolate address books", async () => {
  const runtimes = await Promise.all(
    ["address-book-a", "address-book-a", "address-book-b"].map(
      (containerId, index) =>
        createRecoveryContactsRuntime({
          containerId,
          runtimeKey: `contact-import-device-${index}`,
          signingFingerprint: "owner-signing-key",
          userId: "owner-user",
        }),
    ),
  );
  try {
    const ids: Array<string | null> = [];
    for (const runtime of runtimes) {
      const store = createContactsStore(runtime, {
        resolveUserIdentity: async (userId) => ({
          userId,
          encapsulationPublicKey: "peer-key",
          encapsulationKeyFingerprint: "peer-kem-fingerprint",
          signingPublicKey: "peer-signing-key",
          signingKeyFingerprint: "peer-signing-fingerprint",
        }),
        logError: (message, cause) => {
          throw new Error(String(message), { cause });
        },
      });
      store.updateRuntime(runtime);
      const id = await store.importKey("peer-user");
      expect(id).not.toBeNull();
      expect(await store.importKey("peer-user")).toBe(id);
      expect(
        await defaultDocumentsPersistence.listDocuments(
          runtime.documents.infra.execSql,
        ),
      ).toHaveLength(1);
      ids.push(id);
    }
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
  } finally {
    for (const runtime of runtimes) runtime.close();
  }
});
