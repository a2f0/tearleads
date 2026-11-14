import { expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import {
  addressSurfaces,
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";
import { DocumentContext } from "../../stores/documents/DocumentsProvider";
import { useContactDocumentAddresses } from "./useContactDocumentAddresses";

test("Contacts and Explorer serialize distinct simultaneous intents on one document store", async () => {
  const f = await createAddressRetryHarness("contacts");
  const explorer = renderHook(useContactDocumentAddresses, {
    wrapper: ({ children }) => (
      <DocumentContext.Provider value={f.document}>
        {children}
      </DocumentContext.Provider>
    ),
  });
  try {
    const first = {};
    f.fail();
    await expect(f.actions.onAddAddress(retryFields, first)).rejects.toThrow();
    const [firstId, secondId] = await Promise.all([
      f.actions.onAddAddress(retryFields, first),
      explorer.result.current.actions.onAddAddress(retryFields, {}),
    ]);
    if (!firstId || !secondId) throw new Error("Missing address");
    expect(firstId).not.toBe(secondId);
    expect(f.generatedIds).toHaveLength(2);
    expect(new Set((await f.reopen()).rows.map((row) => row.id))).toEqual(
      new Set([firstId, secondId]),
    );
  } finally {
    explorer.unmount();
    f.close();
  }
});

for (const surface of addressSurfaces) {
  test(`${surface}: a fresh authorized editor can recover a removal after the previous editor closes`, async () => {
    const f = await createAddressRetryHarness(surface);
    let previousEditorActive = true;
    const previousEditor = () => previousEditorActive;
    try {
      const id = await f.actions.onAddAddress(retryFields);
      if (!id) throw new Error("Missing address");
      f.fail();
      await expect(
        f.actions.onRemoveAddress(id, previousEditor),
      ).rejects.toThrow();
      previousEditorActive = false;
      await expect(
        f.actions.onRemoveAddress(id, previousEditor),
      ).rejects.toThrow();
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      expect((await f.reopen()).rows).toHaveLength(1);
      await f.actions.onRemoveAddress(id, () => true);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows).toHaveLength(0);
    } finally {
      f.close();
    }
  });

  test(`${surface}: edits after a failed retry patch retain the original creation ID`, async () => {
    const f = await createAddressRetryHarness(surface);
    try {
      const intent = {};
      f.fail();
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      f.fail(1, 1); // Save the original delta, then fail the edited row patch.
      await expect(
        f.actions.onAddAddress(
          { ...retryFields, street: "Second draft" },
          intent,
        ),
      ).rejects.toThrow();
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      expect((await f.reopen()).rows[0]?.fields).toMatchObject({
        street: retryFields.street,
      });
      const id = await f.actions.onAddAddress(retryFields, intent);
      if (!id) throw new Error("Missing address");
      expect(f.generatedIds).toEqual([id]);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows[0]?.fields).toMatchObject(retryFields);
    } finally {
      f.close();
    }
  });

  test(`${surface}: two independent identical create intents and simultaneous retries stay distinct`, async () => {
    const f = await createAddressRetryHarness(surface);
    try {
      const first = {};
      const second = {};
      f.fail(2);
      await expect(
        f.actions.onAddAddress(retryFields, first),
      ).rejects.toThrow();
      await expect(
        f.actions.onAddAddress(retryFields, first),
      ).rejects.toThrow();
      expect((await f.reopen()).rows).toHaveLength(0);
      const ids = await Promise.all([
        f.actions.onAddAddress(retryFields, first),
        f.actions.onAddAddress(retryFields, second),
        f.actions.onAddAddress(retryFields, first),
      ]);
      expect(ids[0]).toBe(ids[2]);
      expect(ids[0]).not.toBe(ids[1]);
      expect(f.generatedIds).toHaveLength(2);
      expect((await f.reopen()).rows.map((row) => row.id)).toEqual(
        f.generatedIds,
      );
    } finally {
      f.close();
    }
  });

  test(`${surface}: a refused edited retry never becomes a false acknowledgment`, async () => {
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      updateRowFields: async () => undefined,
    }));
    try {
      const intent = {};
      f.fail();
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      const edited = { ...retryFields, street: "Edited" };
      await expect(f.actions.onAddAddress(edited, intent)).rejects.toThrow();
      await expect(f.actions.onAddAddress(edited, intent)).rejects.toThrow();
      expect((await f.reopen()).rows[0]?.fields).toMatchObject({
        street: retryFields.street,
      });
    } finally {
      f.close();
    }
  });

  test(`${surface}: an edited failed create only changes edited cells after another writer saves it`, async () => {
    const f = await createAddressRetryHarness(surface);
    try {
      const intent = {};
      f.fail();
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      await f.document.setStructuredFields("contact", {});
      const id = f.generatedIds[0];
      if (!id) throw new Error("Missing address");
      await f.document.updateRowFields(id, { postalCode: "00999" });
      const before = (await f.reopen()).rows[0];
      expect(
        await f.actions.onAddAddress(
          { ...retryFields, street: "Edited" },
          intent,
        ),
      ).toBe(id);
      const after = (await f.reopen()).rows[0];
      expect(after?.fields).toMatchObject({
        street: "Edited",
        postalCode: "00999",
      });
      const { postalCode } = before?.fieldEditors ?? {};
      expect(after?.fieldEditors).toMatchObject({ postalCode });
      expect(f.generatedIds).toHaveLength(1);
    } finally {
      f.close();
    }
  });
}
