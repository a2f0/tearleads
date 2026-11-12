import { expect, test } from "bun:test";
import { createContactAddressHarness } from "../../../test/helpers/contacts/contactAddressHarness";
import { readContactAddressFields } from "../../document-types/contact/contactAddressModel";

for (const key of ["recordType", "@id", "@updatedBy", "unknown"]) {
  test(`refuses injected ${key} fields instead of publishing them`, async () => {
    const harness = await createContactAddressHarness();
    try {
      const id = await harness.store.createContact({ firstName: "Ada" });
      if (!id) throw new Error("Missing contact");
      const addressId = await harness.store.addContactAddress(
        id,
        readContactAddressFields({ street: "Main" }),
      );
      if (!addressId) throw new Error("Missing address");
      await expect(
        harness.store.updateContactAddress(id, addressId, {
          street: "Changed",
          [key]: "injected",
        }),
      ).rejects.toThrow();
      await expect(
        harness.store.addContactAddress(id, {
          ...readContactAddressFields({ street: "Other" }),
          [key]: "injected",
        }),
      ).rejects.toThrow();
      const rows = harness.documentStores.get(id)?.getSnapshot().rows;
      expect(rows).toHaveLength(1);
      expect(rows?.[0] && readContactAddressFields(rows[0].fields).street).toBe(
        "Main",
      );
    } finally {
      harness.close();
    }
  });
}

for (const rowType of ["future", ""]) {
  test(`refuses update and removal of non-address type '${rowType}'`, async () => {
    const harness = await createContactAddressHarness();
    try {
      const id = await harness.store.createContact({ firstName: "Ada" });
      if (!id) throw new Error("Missing contact");
      const document = harness.documentStores.get(id);
      if (!document) throw new Error("Missing document");
      const rowId = await document.addRow({
        recordType: rowType,
        street: "preserve",
      });
      await expect(
        harness.store.updateContactAddress(id, rowId, { street: "changed" }),
      ).rejects.toThrow();
      await expect(
        harness.store.removeContactAddress(id, rowId),
      ).rejects.toThrow();
      expect(
        readContactAddressFields(document.getSnapshot().rows[0]?.fields ?? {})
          .street,
      ).toBe("preserve");
    } finally {
      harness.close();
    }
  });
}

test("row persistence refusal is observable and does not poison later address writes", async () => {
  let refuse = true;
  const harness = await createContactAddressHarness((store) => ({
    ...store,
    addRow: (fields) =>
      refuse ? Promise.resolve("not-saved") : store.addRow(fields),
  }));
  try {
    const id = await harness.store.createContact({ firstName: "Ada" });
    if (!id) throw new Error("Missing contact");
    const fields = readContactAddressFields({ street: "Main" });
    await expect(harness.store.addContactAddress(id, fields)).rejects.toThrow();
    expect(harness.documentStores.get(id)?.getSnapshot().rows).toEqual([]);
    refuse = false;
    expect(await harness.store.addContactAddress(id, fields)).toBeString();
  } finally {
    harness.close();
  }
});

test("silent update and delete failures must not report success", async () => {
  const harness = await createContactAddressHarness((store) => ({
    ...store,
    updateRowFields: async () => {},
    removeRow: async () => {},
  }));
  try {
    const id = await harness.store.createContact({ firstName: "Ada" });
    if (!id) throw new Error("Missing contact");
    const address = await harness.store.addContactAddress(
      id,
      readContactAddressFields({ street: "Main" }),
    );
    if (!address) throw new Error("Missing address");
    await expect(
      harness.store.updateContactAddress(id, address, { street: "Other" }),
    ).rejects.toThrow();
    await expect(
      harness.store.removeContactAddress(id, address),
    ).rejects.toThrow();
  } finally {
    harness.close();
  }
});
