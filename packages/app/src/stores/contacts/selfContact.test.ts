import { expect, test } from "bun:test";
import { defaultDocumentsPersistence } from "@tearleads/client-sdk";
import { createRecoveryContactsRuntime } from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { createContactsStore, getSelfContactLocalId } from "./contactStore";

// Selection now depends on persisted canonical stream identity, not a scalar
// Map selector. Exercise the public facade against real documents instead.
for (const candidate of [
  "self",
  "promoted",
  "non-self",
  "read-only",
  "named",
] as const) {
  test(`a ${candidate} same-user document does not displace canonical Me`, async () => {
    const runtime = await createRecoveryContactsRuntime({
      signingFingerprint: "self-signing-fingerprint",
      userId: "self-user",
    });
    const localId = getSelfContactLocalId("self-signing-fingerprint");
    const distinctId = "same-user-document-id";
    const execSql = runtime.documents.infra.execSql;
    const errors: unknown[] = [];
    try {
      await runtime.openDocumentStore({ localId }).setStructuredFields(
        "contact",
        {
          encapsulationPublicKey: "self-key",
          isSelf: "1",
          ...(candidate === "promoted" ? { userId: "self-user" } : {}),
        },
        { deferRemoteSync: true },
      );
      await runtime
        .openDocumentStore({ localId: distinctId })
        .setStructuredFields(
          "contact",
          {
            encapsulationPublicKey: "self-key",
            isSelf: candidate === "non-self" ? "0" : "1",
            userId: "self-user",
            ...(candidate === "named"
              ? {
                  firstName: "Recovered",
                  lastName: "User",
                  nickname: "Primary",
                }
              : {}),
          },
          { deferRemoteSync: true },
        );
      if (candidate === "read-only") {
        const record = await defaultDocumentsPersistence.loadDocument(
          execSql,
          distinctId,
        );
        if (!record) throw new Error("Missing distinct contact");
        await defaultDocumentsPersistence.saveDocument(execSql, {
          ...record,
          effectiveAccessLevel: "read",
        });
      }
      const before = await defaultDocumentsPersistence.loadDocument(
        execSql,
        distinctId,
      );
      const history = await defaultDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        distinctId,
      );
      expect(history).not.toBeNull();
      const store = createContactsStore(runtime, {
        resolveVerified: async () => null,
        logError: (message, cause) => errors.push({ message, cause }),
      });
      store.updateRuntime(runtime);
      await waitForCondition(
        () => store.getSnapshot().ready,
        "Contacts not ready",
      );
      expect(
        await store.ensureSelfContact({
          localId,
          userId: "self-user",
          encapsulationPublicKey: "self-key",
          deferRemoteSync: true,
        }),
      ).toBe(localId);
      expect(
        await defaultDocumentsPersistence.loadDocument(execSql, distinctId),
      ).toEqual(before);
      expect(
        await defaultDocumentsPersistence.loadHistoryRestoreState(
          execSql,
          distinctId,
        ),
      ).toEqual(history);
      expect(
        store.getSnapshot().entries.some((entry) => entry.id === distinctId),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      runtime.close();
    }
  });
}
