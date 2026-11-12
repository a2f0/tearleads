import { expect, test } from "bun:test";
import { createContactAddressHarness } from "../../../test/helpers/contacts/contactAddressHarness";
import { readContactAddressFields } from "../../document-types/contact/contactAddressModel";

test("adds a contact address through the document store and projects hydrated rows", async () => {
  const harness = await createContactAddressHarness();
  try {
    const contactId = await harness.store.createContact({ firstName: "Ada" });
    if (!contactId) throw new Error("Missing contact");
    const fields = readContactAddressFields({
      street: " 1 Main Street ",
      postalCode: "00123",
      countryCode: "日本",
    });
    const addressId = await harness.store.addContactAddress(contactId, fields);
    expect(addressId).toBeString();
    const entry = harness.store
      .getSnapshot()
      .entries.find((entry) => entry.id === contactId);
    expect(entry?.rows).toHaveLength(1);
    expect(entry?.rows?.[0]?.fields).toEqual({
      ...fields,
      street: "1 Main Street",
      recordType: "postalAddress",
    });
    expect(entry?.documentId).toBeNull();
    expect(entry?.syncing).toBe(false);
    expect(harness.errors).toEqual([]);
  } finally {
    harness.close();
  }
});

test("updates only changed allowed cells and removes only the selected address", async () => {
  const patches: Readonly<Record<string, string>>[] = [];
  const harness = await createContactAddressHarness((store) => ({
    ...store,
    updateRowFields: async (id, patch) => {
      patches.push(patch);
      await store.updateRowFields(id, patch);
    },
  }));
  try {
    const id = await harness.store.createContact({ firstName: "Ada" });
    if (!id) throw new Error("Missing contact");
    const first = await harness.store.addContactAddress(
      id,
      readContactAddressFields({ street: "Main", postalCode: "00123" }),
    );
    const second = await harness.store.addContactAddress(
      id,
      readContactAddressFields({ street: "Other" }),
    );
    const document = harness.documentStores.get(id);
    if (!first || !second || !document) throw new Error("Missing address");
    const unknown = await document.addRow({
      recordType: "future",
      content: "preserve",
    });
    await harness.store.updateContactAddress(id, first, {
      street: " Main ",
      postalCode: " 00001 ",
    });
    expect(patches).toEqual([{ postalCode: "00001" }]);
    await harness.store.updateContactAddress(id, first, {
      postalCode: "00001",
    });
    expect(patches).toHaveLength(1);
    expect(
      readContactAddressFields(
        document.getSnapshot().rows.find((row) => row.id === first)?.fields ??
          {},
      ).street,
    ).toBe("Main");
    await harness.store.removeContactAddress(id, first);
    expect(
      harness.store
        .getSnapshot()
        .entries.find((entry) => entry.id === id)
        ?.rows?.map((row) => row.id),
    ).toEqual([second, unknown]);
  } finally {
    harness.close();
  }
});
