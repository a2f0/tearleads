import { expect, test } from "bun:test";
import {
  addressSurfaces,
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";

test("a refused intent cannot move stores and simultaneous retries remain one creation", async () => {
  let additions = 0;
  const original = await createAddressRetryHarness("contacts", (store) => ({
    ...store,
    async addRow(...args) {
      additions += 1;
      if (additions === 1) return crypto.randomUUID();
      return store.addRow(...args);
    },
  }));
  try {
    const other = await createAddressRetryHarness("explorer");
    try {
      const intent = {};
      await expect(
        original.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      await expect(
        other.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      expect((await other.reopen()).rows).toHaveLength(0);
      const [first, repeated, distinct] = await Promise.all([
        original.actions.onAddAddress(retryFields, intent),
        original.actions.onAddAddress(retryFields, intent),
        original.actions.onAddAddress(retryFields, {}),
      ]);
      if (!first || !repeated || !distinct)
        throw new Error("Missing addresses");
      expect(first).toBe(repeated);
      expect(first).not.toBe(distinct);
      expect(original.generatedIds).toEqual([first, distinct]);
      expect((await original.reopen()).rows.map((row) => row.id)).toEqual([
        first,
        distinct,
      ]);
    } finally {
      other.close();
    }
  } finally {
    original.close();
  }
});

for (const surface of addressSurfaces) {
  test(`${surface}: repeated no-effect adds recover with the same creation intent`, async () => {
    let refusals = 2;
    let additions = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      async addRow(...args) {
        additions += 1;
        // The SDK returns a generated ID even when it refuses before mutation.
        if (refusals > 0) {
          refusals -= 1;
          return crypto.randomUUID();
        }
        return store.addRow(...args);
      },
    }));
    try {
      const intent = {};
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(
          f.actions.onAddAddress(retryFields, intent),
        ).rejects.toThrow();
        expect(f.document.hasUnsavedLocalEdits()).toBe(false);
        expect((await f.reopen()).rows).toHaveLength(0);
      }
      f.fail();
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      expect(f.document.getSnapshot().rows).toHaveLength(0);
      expect((await f.reopen()).rows).toHaveLength(0);
      const originalId = f.generatedIds[0];
      if (!originalId) throw new Error("Missing original address");
      const id = await f.actions.onAddAddress(retryFields, intent);
      if (!id) throw new Error("Missing address");
      expect(id).toBe(originalId);
      expect(additions).toBe(3);
      expect(f.generatedIds).toEqual([id]);
      const durable = await f.reopen();
      expect(durable.rows.map((row) => row.id)).toEqual([id]);
      expect(durable.rows[0]?.fields).toMatchObject(retryFields);
    } finally {
      f.close();
    }
  });

  for (const action of ["update", "edit-creation"]) {
    test(`${surface}: ${action} survives repeated refusals then a real persistence failure`, async () => {
      let refusals = 2;
      let updates = 0;
      const f = await createAddressRetryHarness(surface, (store) => ({
        ...store,
        async updateRowFields(...args) {
          updates += 1;
          if (refusals > 0) {
            refusals -= 1;
            return;
          }
          await store.updateRowFields(...args);
        },
      }));
      try {
        const intent = {};
        const id = await f.actions.onAddAddress(retryFields, intent);
        if (!id) throw new Error("Missing address");
        const edited = { ...retryFields, street: "Edited" };
        const update = () =>
          action === "update"
            ? f.actions.onUpdateAddress(id, { street: edited.street })
            : f.actions.onAddAddress(edited, intent);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await expect(update()).rejects.toThrow();
          expect(f.document.hasUnsavedLocalEdits()).toBe(false);
          expect((await f.reopen()).rows[0]?.fields).toMatchObject(retryFields);
        }
        f.fail();
        await expect(update()).rejects.toThrow();
        expect(f.document.hasUnsavedLocalEdits()).toBe(true);
        expect((await f.reopen()).rows[0]?.fields).toMatchObject(retryFields);
        await update();
        expect(updates).toBe(3);
        expect(f.generatedIds).toEqual([id]);
        const durable = await f.reopen();
        expect(durable.rows.map((row) => row.id)).toEqual([id]);
        expect(durable.rows[0]?.fields).toMatchObject(edited);
        expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      } finally {
        f.close();
      }
    });
  }

  test(`${surface}: unrelated dirty edits do not turn a refused add into a phantom creation`, async () => {
    let additions = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      async addRow(...args) {
        additions += 1;
        if (additions === 1) return crypto.randomUUID();
        return store.addRow(...args);
      },
    }));
    try {
      const intent = {};
      f.fail();
      await f.document.setStructuredFields("contact", {
        lastName: "Unrelated",
      });
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      expect(f.generatedIds).toHaveLength(0);
      expect((await f.reopen()).rows).toHaveLength(0);
      f.fail();
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      expect(additions).toBe(1);
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      const edited = { ...retryFields, street: "Edited after refusal" };
      const id = await f.actions.onAddAddress(edited, intent);
      if (!id) throw new Error("Missing address");
      expect(additions).toBe(2);
      expect(f.generatedIds).toEqual([id]);
      const durable = await f.reopen();
      expect(durable.rows.map((row) => row.id)).toEqual([id]);
      expect(durable.rows[0]?.fields).toMatchObject(edited);
      expect(durable.structuredFields).toMatchObject({
        firstName: "Ada",
        lastName: "Unrelated",
      });
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
    } finally {
      f.close();
    }
  });

  test(`${surface}: the original creation lifetime must survive a healthy retry's flush`, async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let hold = false;
    let originalActive = true;
    let additions = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      async addRow(...args) {
        additions += 1;
        if (additions === 1) return crypto.randomUUID();
        return store.addRow(...args);
      },
      async setStructuredFields(...args) {
        await store.setStructuredFields(...args);
        if (hold) {
          entered.resolve();
          await release.promise;
        }
      },
    }));
    try {
      const intent = {};
      f.fail();
      await f.document.setStructuredFields("contact", {
        lastName: "Unrelated",
      });
      await expect(
        f.actions.onAddAddress(retryFields, intent, () => originalActive),
      ).rejects.toThrow();
      hold = true;
      const retry = f.actions
        .onAddAddress(retryFields, intent, () => true)
        .then(
          () => null,
          (error: unknown) => error,
        );
      await entered.promise;
      originalActive = false;
      release.resolve();
      expect(await retry).toBeInstanceOf(Error);
      expect(additions).toBe(1);
      expect((await f.reopen()).rows).toHaveLength(0);
      await expect(
        f.actions.onAddAddress(retryFields, intent, () => true),
      ).rejects.toThrow();
      expect(additions).toBe(1);
    } finally {
      release.resolve();
      f.close();
    }
  });

  test(`${surface}: a refused intent stays bound to its original author`, async () => {
    let author: string | null = null;
    let additions = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      // Only identity metadata changes; rows and persistence remain SDK-backed.
      getSnapshot: () => ({ ...store.getSnapshot(), currentAuthorId: author }),
      async addRow(...args) {
        additions += 1;
        if (additions === 1) return crypto.randomUUID();
        return store.addRow(...args);
      },
    }));
    try {
      const intent = {};
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      author = "different-author";
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      expect(additions).toBe(1);
      expect((await f.reopen()).rows).toHaveLength(0);
      const id = await f.actions.onAddAddress(retryFields, {});
      if (!id) throw new Error("Missing address");
      expect((await f.reopen()).rows.map((row) => row.id)).toEqual([id]);
    } finally {
      f.close();
    }
  });

  test(`${surface}: a confirmed creation removed later cannot restart its original intent`, async () => {
    const f = await createAddressRetryHarness(surface);
    try {
      const intent = {};
      const id = await f.actions.onAddAddress(retryFields, intent);
      if (!id) throw new Error("Missing address");
      await f.actions.onRemoveAddress(id);
      await expect(
        f.actions.onAddAddress(retryFields, intent),
      ).rejects.toThrow();
      expect(f.generatedIds).toEqual([id]);
      expect((await f.reopen()).rows).toHaveLength(0);
    } finally {
      f.close();
    }
  });

  test(`${surface}: a refused removal preserves unrelated pending fields while retrying`, async () => {
    let removals = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      async removeRow(...args) {
        removals += 1;
        if (removals === 1) return;
        await store.removeRow(...args);
      },
    }));
    try {
      const id = await f.actions.onAddAddress(retryFields);
      if (!id) throw new Error("Missing address");
      f.fail();
      await f.document.setStructuredFields("contact", {
        lastName: "Unrelated",
      });
      await expect(f.actions.onRemoveAddress(id)).rejects.toThrow();
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      expect((await f.reopen()).rows.map((row) => row.id)).toEqual([id]);
      await f.actions.onRemoveAddress(id);
      expect(removals).toBe(2);
      const durable = await f.reopen();
      expect(durable.rows).toHaveLength(0);
      expect(durable.structuredFields).toMatchObject({
        firstName: "Ada",
        lastName: "Unrelated",
      });
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
    } finally {
      f.close();
    }
  });

  test(`${surface}: repeated no-effect removals retry the SDK operation`, async () => {
    let refusals = 2;
    let removals = 0;
    const f = await createAddressRetryHarness(surface, (store) => ({
      ...store,
      async removeRow(...args) {
        removals += 1;
        // Model the SDK's early return before mutation; all reads stay real.
        if (refusals > 0) {
          refusals -= 1;
          return;
        }
        await store.removeRow(...args);
      },
    }));
    try {
      const id = await f.actions.onAddAddress(retryFields);
      if (!id) throw new Error("Missing address");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(f.actions.onRemoveAddress(id)).rejects.toThrow();
        expect(f.document.hasUnsavedLocalEdits()).toBe(false);
        expect((await f.reopen()).rows.map((row) => row.id)).toEqual([id]);
      }
      f.fail();
      await expect(f.actions.onRemoveAddress(id)).rejects.toThrow();
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      expect((await f.reopen()).rows.map((row) => row.id)).toEqual([id]);
      await f.actions.onRemoveAddress(id);
      expect(removals).toBe(3);
      expect((await f.reopen()).rows).toHaveLength(0);
    } finally {
      f.close();
    }
  });
}
