import { expect, test } from "bun:test";
import { prepareAddressAuthor } from "../../../test/helpers/contacts/contactAddressAuthorHarness";
import {
  addressSurfaces,
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";

for (const surface of addressSurfaces) {
  test(`${surface}: the first address after sign-in acknowledges its durable row and same-intent retry`, async () => {
    const f = await createAddressRetryHarness(surface);
    try {
      const identity = await prepareAddressAuthor(f);
      expect(f.document.getSnapshot().currentAuthorId).toBeNull();
      const before = identity.runtimeFor(null);
      const documents = identity.apply("signed-in-author");
      expect(documents.crypto).toBe(before.crypto);
      expect(documents.infra.execSql).toBe(before.infra.execSql);
      expect(documents.state.domainScope).toBe(before.state.domainScope);
      // Keep the real SDK store, snapshot, queue and SQLite persistence. The
      // document remains offline: this covers local sign-in identity adoption,
      // not server registration or an authenticated remote sync.
      const intent = {};
      const save = () =>
        f.actions.onAddAddress(retryFields, intent).then(
          (id) => ({ id, error: null }),
          (error: unknown) => ({ id: null, error }),
        );
      const first = await save();
      const durable = await f.reopen();
      const retry = await save();

      // Read durable state independently before asserting acknowledgment: a
      // rejected promise must not hide a row that actually committed.
      expect(durable.rows).toHaveLength(1);
      const row = durable.rows[0];
      if (!row) throw new Error("Missing durable address");
      expect(row).toMatchObject({
        createdBy: "signed-in-author",
        fields: retryFields,
      });
      expect(f.document.getSnapshot().currentAuthorId).toBe("signed-in-author");
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect(f.generatedIds).toEqual([row.id]);
      expect([first.error, retry.error]).toEqual([null, null]);
      expect(first.id).toBe(row.id);
      expect(retry.id).toBe(first.id);
      expect((await f.reopen()).rows).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  for (const operation of ["update", "remove"] as const) {
    test(`${surface}: the first address ${operation} after sign-in acknowledges its durable result`, async () => {
      const f = await createAddressRetryHarness(surface);
      try {
        const identity = await prepareAddressAuthor(f);
        const id = await f.actions.onAddAddress(retryFields);
        if (!id) throw new Error("Missing address fixture");
        expect(f.document.getSnapshot().currentAuthorId).toBeNull();
        identity.apply("signed-in-author");
        const run = () =>
          operation === "update"
            ? f.actions.onUpdateAddress(id, { street: "2 Main Street" })
            : f.actions.onRemoveAddress(id);
        const error = await run().then(
          () => null,
          (cause: unknown) => cause,
        );
        const durable = await f.reopen();
        if (operation === "update") {
          expect(durable.rows).toHaveLength(1);
          expect(durable.rows[0]).toMatchObject({
            id,
            fields: { ...retryFields, street: "2 Main Street" },
            updatedBy: "signed-in-author",
          });
        } else expect(durable.rows).toEqual([]);
        expect(f.document.hasUnsavedLocalEdits()).toBe(false);
        expect(error).toBeNull();
      } finally {
        f.close();
      }
    });
  }
}
