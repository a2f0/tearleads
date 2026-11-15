import { expect, test } from "bun:test";
import { createContactAddressHarness } from "../../../test/helpers/contacts/contactAddressHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { readContactAddressFields } from "../../document-types/contact/contactAddressModel";
import { ContactAddressWriteRefusal } from "../../document-types/contact/contactAddressWriteRefusal";
import { updateContactAddressRow } from "./contactAddressWrites";

test("a queued write refuses before effects when its store became read-only", async () => {
  const release = Promise.withResolvers<void>();
  let hold = false;
  let held = false;
  let canWrite = true;
  let mutations = 0;
  const harness = await createContactAddressHarness((document) => ({
    ...document,
    getSnapshot: () => ({ ...document.getSnapshot(), canWrite }),
    updateRowFields: async (...args) => {
      mutations++;
      if (hold) {
        held = true;
        await release.promise;
      }
      await document.updateRowFields(...args);
    },
  }));
  try {
    const id = await harness.store.createContact({ firstName: "Ada" });
    if (!id) throw new Error("Missing contact");
    const row = await harness.store.addContactAddress(
      id,
      readContactAddressFields({ street: "Main" }),
    );
    if (!row) throw new Error("Missing address");
    const document = harness.documentStores.get(id);
    if (!document) throw new Error("Missing document");

    hold = true;
    const first = updateContactAddressRow(
      document,
      row,
      { street: "First" },
      () => true,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await waitForCondition(() => held, "First write did not start");
    const queued = updateContactAddressRow(
      document,
      row,
      { street: "Queued" },
      () => true,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    canWrite = false;
    release.resolve();
    // The first write had effects, so its failure stays uncertain.
    const firstError = await first;
    expect(firstError).toBeInstanceOf(Error);
    expect(firstError).not.toBeInstanceOf(ContactAddressWriteRefusal);
    expect(await queued).toBeInstanceOf(ContactAddressWriteRefusal);
    expect(mutations).toBe(1);
    expect(
      readContactAddressFields(
        document.getSnapshot().rows.find((entry) => entry.id === row)?.fields ??
          {},
      ).street,
    ).toBe("Main");
  } finally {
    release.resolve();
    harness.close();
  }
});
