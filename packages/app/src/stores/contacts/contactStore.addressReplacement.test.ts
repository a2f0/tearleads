import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import {
  createRecoveryContactsRuntime,
  seedDuplicateSelfContacts,
} from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { readContactAddressFields } from "../../document-types/contact/contactAddressModel";
import { createContactsStore } from "./contactStore";
import type { ContactsRuntime } from "./contactStoreTypes";

for (const operation of ["add", "update", "remove"] as const) {
  test(`${operation} queued behind a write keeps its original contact target`, async () => {
    const base = await createRecoveryContactsRuntime({
      signingFingerprint: "offline-self",
      userId: "self-user",
    });
    const localId = await seedDuplicateSelfContacts(base);
    const original = base.openDocumentStore({ localId });
    const address = await original.addRow({
      recordType: "postalAddress",
      street: "Main",
    });
    const distinct = base.openDocumentStore({ localId: "recovered-self" });
    const otherAddress = await distinct.addRow({
      recordType: "postalAddress",
      street: "Untouched",
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const errors: unknown[] = [];
    const runtime: ContactsRuntime = {
      ...base,
      openDocumentStore: (input) => {
        const document = base.openDocumentStore(input);
        return {
          ...document,
          setStructuredFields: async (...args) => {
            const { nickname } = args[1];
            if (input.localId === localId && nickname === "Blocker") {
              started.resolve();
              await release.promise;
            }
            return document.setStructuredFields(...args);
          },
        };
      },
    };
    const store = createContactsStore(runtime, {
      resolveVerified: async () => null,
      logError: (message, cause) => errors.push({ message, cause }),
    });
    let blocker: Promise<void> | undefined;
    let edit: Promise<string | null> | Promise<void> | undefined;
    try {
      store.updateRuntime(runtime);
      await waitForCondition(
        () => store.getSnapshot().ready,
        "Contacts not ready",
      );
      blocker = store.updateContact(localId, { nickname: "Blocker" });
      await Promise.race([
        started.promise,
        blocker.then(() => {
          throw new Error("Blocker settled before entering its write");
        }),
      ]);
      // Address writes join the same real Contacts write chain synchronously.
      edit =
        operation === "add"
          ? store.addContactAddress(
              localId,
              readContactAddressFields({ street: "Other" }),
            )
          : operation === "update"
            ? store.updateContactAddress(localId, address, { street: "Other" })
            : store.removeContactAddress(localId, address);
      release.resolve();
      const [addressId] = await Promise.all([edit, blocker]);
      const reopened = createDocumentStore(localId, base.documents);
      const untouched = createDocumentStore("recovered-self", base.documents);
      expect(await reopened.ensureInitialized()).toBe(true);
      expect(await untouched.ensureInitialized()).toBe(true);
      const rows = reopened.getSnapshot().rows;
      if (operation === "add") {
        expect(typeof addressId).toBe("string");
        if (typeof addressId !== "string") {
          throw new Error("Address creation was not acknowledged");
        }
        expect(rows.map((row) => row.id)).toEqual([address, addressId]);
        expect(
          rows.map((row) => readContactAddressFields(row.fields).street),
        ).toEqual(["Main", "Other"]);
      }
      if (operation === "update") {
        expect(rows.map((row) => row.id)).toEqual([address]);
        expect(readContactAddressFields(rows[0]?.fields ?? {}).street).toBe(
          "Other",
        );
      }
      if (operation === "remove") expect(rows).toEqual([]);
      expect(untouched.getSnapshot().rows).toEqual([
        expect.objectContaining({
          id: otherAddress,
          fields: expect.objectContaining({ street: "Untouched" }),
        }),
      ]);
      expect(errors).toEqual([]);
    } finally {
      release.resolve();
      await Promise.allSettled([blocker, edit]);
      store.updateRuntime({
        ...runtime,
        documents: {
          ...runtime.documents,
          infra: { ...runtime.documents.infra, dbStatus: "terminated" },
        },
      });
      base.close();
    }
  });
}
