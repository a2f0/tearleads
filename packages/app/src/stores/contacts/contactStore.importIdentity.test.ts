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
        resolveVerified: async (userId) => ({
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
      const id = await store.importVerifiedUser("peer-user");
      expect(id).not.toBeNull();
      expect(await store.importVerifiedUser("peer-user")).toBe(id);
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

test("a user whose identity no link verified is not imported", async () => {
  const runtime = await createRecoveryContactsRuntime({
    containerId: "address-book-a",
    runtimeKey: "contact-import-unverified",
    signingFingerprint: "owner-signing-key",
    userId: "owner-user",
  });
  try {
    const requested: string[] = [];
    const store = createContactsStore(runtime, {
      // `userIdentities.resolveVerified` answers null for a pin that was only
      // observed on first sight, exactly as for an unknown user.
      resolveVerified: async (userId) => {
        requested.push(userId);
        return null;
      },
      // An empty address book has no tables to load yet.
      logError: () => {},
    });
    store.updateRuntime(runtime);
    expect(await store.importVerifiedUser("peer-user")).toBeNull();
    expect(requested).toEqual(["peer-user"]);
    expect(store.getSnapshot().entries).toEqual([]);
    expect(
      await runtime.documents.infra.execSql(
        "SELECT COUNT(*) AS count FROM documents",
      ),
    ).toEqual([{ count: 0 }]);
  } finally {
    runtime.close();
  }
});
