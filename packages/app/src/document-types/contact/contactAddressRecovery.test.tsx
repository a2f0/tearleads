import { expect, test } from "bun:test";
import {
  addressSurfaces,
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";

for (const surface of addressSurfaces) {
  test(`${surface}: repeated removal failure recovers even after its row disappears from the snapshot`, async () => {
    const f = await createAddressRetryHarness(surface);
    try {
      const id = await f.actions.onAddAddress(retryFields);
      if (!id) throw new Error("Missing address");
      f.fail();
      await expect(f.actions.onRemoveAddress(id)).rejects.toThrow();
      expect((await f.reopen()).rows.map((row) => row.id)).toEqual([id]);
      // A no-op SDK retry publishes live Loro without persisting the delta.
      await f.document.removeRow(id);
      expect(f.document.getSnapshot().rows).toHaveLength(0);
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      f.fail();
      await expect(f.actions.onRemoveAddress(id)).rejects.toThrow();
      expect((await f.reopen()).rows.map((row) => row.id)).toEqual([id]);
      await f.actions.onRemoveAddress(id);
      expect(f.failures()).toBe(2);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows).toHaveLength(0);
      await expect(f.actions.onRemoveAddress("unknown")).rejects.toThrow();
    } finally {
      f.close();
    }
  });

  test(`${surface}: an unchanged update retry flushes its pending delta`, async () => {
    let mutations = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      updateRowFields: async (...args) => {
        mutations += 1;
        await store.updateRowFields(...args);
      },
    }));
    try {
      const id = await f.actions.onAddAddress(retryFields);
      if (!id) throw new Error("Missing address");
      f.fail();
      await expect(
        f.actions.onUpdateAddress(id, { street: "Changed" }),
      ).rejects.toThrow();
      expect((await f.reopen()).rows[0]?.fields).toMatchObject({
        street: retryFields.street,
      });
      await f.document.removeRow("not-existing");
      expect(f.document.getSnapshot().rows[0]?.fields).toMatchObject({
        street: "Changed",
      });
      f.fail();
      await expect(
        f.actions.onUpdateAddress(id, { street: "Changed" }),
      ).rejects.toThrow();
      await f.actions.onUpdateAddress(id, { street: "Changed" });
      expect(f.failures()).toBe(2);
      const durable = await f.reopen();
      expect(durable.rows[0]?.fields).toMatchObject({
        street: "Changed",
        postalCode: "00123",
      });
      expect(mutations).toBe(1);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
    } finally {
      f.close();
    }
  });

  test(`${surface}: add retries retain the original durable row identity`, async () => {
    const f = await createAddressRetryHarness(surface);
    try {
      const intent = {};
      f.fail();
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      expect(f.failures()).toBe(1);
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      expect((await f.reopen()).rows).toHaveLength(0);
      const originalId = f.generatedIds[0];
      if (!originalId) throw new Error("Missing original ID");
      const id = await f.actions.onAddAddress(retryFields, intent);
      expect(id).toBe(originalId);
      expect(f.generatedIds).toHaveLength(1);
      const durable = await f.reopen();
      expect(durable.rows.map((row) => row.id)).toEqual([originalId]);
      expect(durable.rows[0]?.fields).toMatchObject(retryFields);
      expect(durable.structuredFields).toMatchObject({ firstName: "Ada" });
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
    } finally {
      f.close();
    }
  });
}
