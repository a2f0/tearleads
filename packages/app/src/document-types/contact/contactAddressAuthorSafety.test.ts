import { expect, test } from "bun:test";
import {
  type DocumentSnapshot,
  defaultDocumentsPersistence,
} from "@tearleads/client-sdk";
import { prepareAddressAuthor } from "../../../test/helpers/contacts/contactAddressAuthorHarness";
import { createQueuedAuthorityHarness } from "../../../test/helpers/contacts/contactAddressQueuedAuthorityHarness";
import {
  addressSurfaces,
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";

const ORIGINAL_AUTHOR = "address-original-author";
const NEXT_AUTHOR = "address-next-author";
type Harness = Awaited<ReturnType<typeof createAddressRetryHarness>>;

function settle<T>(work: Promise<T>) {
  return work.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
}

function content(snapshot: DocumentSnapshot) {
  const { rows, structuredFields, text, title } = snapshot;
  return { rows, structuredFields, text, title };
}

async function failedCreation(f: Harness, intent: object) {
  f.fail();
  const result = await settle(
    f.actions.onAddAddress(retryFields, intent, () => true),
  );
  expect(result.status).toBe("rejected");
  expect(f.failures()).toBe(1);
  expect(f.generatedIds).toHaveLength(1);
  expect(f.document.hasUnsavedLocalEdits()).toBe(true);
  expect(f.document.getSnapshot().rows).toEqual([]);
  expect((await f.reopen()).rows).toEqual([]);
  const id = f.generatedIds[0];
  if (!id) throw new Error("Missing failed creation ID");
  return id;
}

function holdNextCommit() {
  const original = defaultDocumentsPersistence.commitDocumentMutation;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let hold = true;
  defaultDocumentsPersistence.commitDocumentMutation = async (...args) => {
    if (hold) {
      hold = false;
      entered.resolve();
      await release.promise;
    }
    return original(...args);
  };
  return {
    async reached(operation: Promise<unknown>) {
      await Promise.race([
        entered.promise,
        operation.then(() => {
          throw new Error("Address settled before entering persistence");
        }),
      ]);
    },
    release: () => release.resolve(),
    restore: () => {
      defaultDocumentsPersistence.commitDocumentMutation = original;
    },
  };
}

function expectMetadataOnly(before: DocumentSnapshot, after: DocumentSnapshot) {
  expect(after).toEqual({ ...before, currentAuthorId: NEXT_AUTHOR });
  for (const key of [
    "rows",
    "structuredFields",
    "attachments",
    "attachmentStatusBySlotId",
    "attachmentStorageKeyBySlotId",
    "fieldValidationIssues",
  ] as const) {
    expect(after[key]).toBe(before[key]);
  }
}

for (const surface of addressSurfaces) {
  test(`${surface}: a real author transition refuses an add already in the SDK queue`, async () => {
    const f = await createQueuedAuthorityHarness(surface);
    try {
      const author = await prepareAddressAuthor(f);
      author.apply(ORIGINAL_AUTHOR);
      expect(f.document.getSnapshot().currentAuthorId).toBe(ORIGINAL_AUTHOR);
      const durableBefore = content(await f.reopen());
      const intent = {};
      await f.blockPredecessor();
      const { settlement } = await f.enqueue("add", () =>
        f.actions.onAddAddress(retryFields, intent, () => true),
      );
      expect(f.document.hasQueuedWrites()).toBe(true);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      author.apply(NEXT_AUTHOR);
      expect(f.document.getSnapshot().currentAuthorId).toBe(NEXT_AUTHOR);
      await f.releaseAndDrain();
      expect((await settlement).status).toBe("rejected");
      expect(f.document.hasQueuedWrites()).toBe(false);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect(f.document.getSnapshot().rows).toEqual([]);
      expect(content(await f.reopen())).toEqual(durableBefore);
      expect(
        (await settle(f.actions.onAddAddress(retryFields, intent))).status,
      ).toBe("rejected");
      expect(f.generatedIds).toHaveLength(1);
      // A valid successor must not uncover a hidden stale row in live Loro.
      await f.document.setStructuredFields("contact", {});
      expect(content(await f.reopen())).toEqual(durableBefore);
    } finally {
      await f.close();
    }
  });

  for (const recovery of ["direct", "queued"] as const) {
    test(`${surface}: author change refuses ${recovery} recovery of a failed creation`, async () => {
      const f = await createQueuedAuthorityHarness(surface);
      try {
        const author = await prepareAddressAuthor(f);
        author.apply(ORIGINAL_AUTHOR);
        const durableBefore = content(await f.reopen());
        const intent = {};
        const id = await failedCreation(f, intent);
        if (recovery === "queued") {
          // Revalidate identity without persisting the failed creation's delta.
          await f.blockPredecessor(true);
          const { settlement } = await f.enqueue("flush", () =>
            f.actions.onAddAddress(retryFields, intent, () => true),
          );
          expect(f.document.hasQueuedWrites()).toBe(true);
          author.apply(NEXT_AUTHOR);
          await f.releaseAndDrain();
          expect((await settlement).status).toBe("rejected");
        } else {
          author.apply(NEXT_AUTHOR);
        }
        expect(f.document.getSnapshot().currentAuthorId).toBe(NEXT_AUTHOR);
        // A fresh caller is valid, but the creation still belongs to the old
        // author; neither original nor retry editor lifetime was cancelled.
        const retry = await settle(
          f.actions.onAddAddress(retryFields, intent, () => true),
        );
        expect(retry.status).toBe("rejected");
        expect(f.generatedIds).toEqual([id]);
        expect(f.document.hasQueuedWrites()).toBe(false);
        expect(f.document.hasUnsavedLocalEdits()).toBe(true);
        expect(content(await f.reopen())).toEqual(durableBefore);
      } finally {
        await f.close();
      }
    });
  }

  test(`${surface}: author metadata preserves optimistic fields and an unpublished address`, async () => {
    const f = await createAddressRetryHarness(surface);
    let unsubscribe = () => {};
    try {
      const author = await prepareAddressAuthor(f);
      author.apply(ORIGINAL_AUTHOR);
      const durableBefore = content(await f.reopen());
      f.fail();
      await f.document.setStructuredFields("contact", { lastName: "Draft" });
      // Structured fields publish optimistically; a failed row stays hidden.
      f.fail();
      expect(
        (await settle(f.actions.onAddAddress(retryFields, {}))).status,
      ).toBe("rejected");
      expect(f.failures()).toBe(2);
      expect(f.generatedIds).toHaveLength(1);
      const before = f.document.getSnapshot();
      expect(before.rows).toEqual([]);
      expect(before.structuredFields).toEqual({
        ...durableBefore.structuredFields,
        lastName: "Draft",
      });
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      const notifications: DocumentSnapshot[] = [];
      unsubscribe = f.document.subscribe(() => {
        notifications.push(f.document.getSnapshot());
      });
      const runtime = author.apply(NEXT_AUTHOR);
      const after = f.document.getSnapshot();
      expectMetadataOnly(before, after);
      expect(notifications).toEqual([after]);
      f.document.updateRuntime(runtime);
      expect(f.document.getSnapshot()).toBe(after);
      expect(notifications).toEqual([after]);
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      expect(content(await f.reopen())).toEqual(durableBefore);
      // Explicit SDK recovery proves metadata did not discard the hidden row.
      // This is not a retry of the old author's app-layer creation intent.
      await f.document.setStructuredFields("contact", {});
      const durable = await f.reopen();
      expect(durable.rows.map((row) => row.id)).toEqual(f.generatedIds);
      expect(durable.rows[0]).toMatchObject({
        fields: retryFields,
        createdBy: ORIGINAL_AUTHOR,
        updatedBy: ORIGINAL_AUTHOR,
      });
      expect(durable.structuredFields).toEqual(before.structuredFields);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
    } finally {
      unsubscribe();
      f.close();
    }
  });

  test(`${surface}: cancelling an editor after live application does not roll back durability`, async () => {
    const f = await createAddressRetryHarness(surface);
    const owned: Promise<unknown>[] = [];
    let barrier: ReturnType<typeof holdNextCommit> | undefined;
    let active = true;
    try {
      const author = await prepareAddressAuthor(f);
      author.apply(ORIGINAL_AUTHOR);
      const durableBefore = content(await f.reopen());
      const intent = {};
      barrier = holdNextCommit();
      const settlement = settle(
        f.actions.onAddAddress(retryFields, intent, () => active),
      );
      owned.push(settlement);
      await barrier.reached(settlement);
      expect(f.document.hasQueuedWrites()).toBe(true);
      expect(f.document.hasUnsavedLocalEdits()).toBe(true);
      expect(f.document.getSnapshot().rows).toEqual([]);
      // Fresh-store initialization shares the persistence lock; reopen only
      // after the held commit drains, not while awaiting our own release.
      active = false;
      barrier.release();
      expect((await settlement).status).toBe("rejected");
      expect(f.document.hasQueuedWrites()).toBe(false);
      expect(f.document.hasUnsavedLocalEdits()).toBe(false);
      expect(f.generatedIds).toHaveLength(1);
      const durable = await f.reopen();
      expect(durable.rows.map((row) => row.id)).toEqual(f.generatedIds);
      expect(durable.rows[0]).toMatchObject({
        fields: retryFields,
        createdBy: ORIGINAL_AUTHOR,
        updatedBy: ORIGINAL_AUTHOR,
      });
      expect(f.document.getSnapshot().rows).toEqual(durable.rows);
      expect(durable.structuredFields).toEqual(durableBefore.structuredFields);
      expect(
        (await settle(f.actions.onAddAddress(retryFields, intent, () => true)))
          .status,
      ).toBe("rejected");
      expect(f.generatedIds).toHaveLength(1);
      expect(content(await f.reopen())).toEqual(content(durable));
    } finally {
      barrier?.release();
      await Promise.allSettled(owned);
      barrier?.restore();
      f.close();
    }
  });
}
