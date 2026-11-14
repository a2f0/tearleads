import { expect, test } from "bun:test";
import type { DocumentSnapshot } from "@tearleads/client-sdk";
import { createQueuedAuthorityHarness } from "../../../test/helpers/contacts/contactAddressQueuedAuthorityHarness";
import {
  addressSurfaces,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";

type Harness = Awaited<ReturnType<typeof createQueuedAuthorityHarness>>;
type Operation = "add" | "update" | "remove" | "edit-creation";

function rowValues(rows: DocumentSnapshot["rows"]) {
  return rows.map(({ id, fields }) => ({ id, fields }));
}

async function prepare(f: Harness, operation: Operation) {
  const intent = {};
  const id =
    operation === "add"
      ? null
      : await f.actions.onAddAddress(retryFields, intent);
  const expected = rowValues((await f.reopen()).rows);
  const run = (current: () => boolean) => {
    if (operation === "add")
      return f.actions.onAddAddress(retryFields, intent, current);
    if (!id) throw new Error("Missing address fixture");
    if (operation === "update")
      return f.actions.onUpdateAddress(
        id,
        { street: "Forbidden edit" },
        current,
      );
    if (operation === "remove") return f.actions.onRemoveAddress(id, current);
    return f.actions.onAddAddress(
      { ...retryFields, street: "Forbidden edit" },
      intent,
      current,
    );
  };
  return { expected, run };
}

for (const surface of addressSurfaces) {
  for (const operation of [
    "add",
    "update",
    "remove",
    "edit-creation",
  ] as const) {
    test(`${surface}: an expired editor cannot ${operation} an address waiting in the SDK queue`, async () => {
      const f = await createQueuedAuthorityHarness(surface);
      let active = true;
      try {
        const { expected, run } = await prepare(f, operation);
        await f.blockPredecessor();
        expect(f.document.hasQueuedWrites()).toBe(true);
        expect(f.document.hasUnsavedLocalEdits()).toBe(false);
        const { settlement } = await f.enqueue(
          operation === "edit-creation" ? "update" : operation,
          () => run(() => active),
        );
        expect(rowValues(f.document.getSnapshot().rows)).toEqual(expected);
        active = false;
        f.release();
        const result = await settlement;
        const liveRows = rowValues(f.document.getSnapshot().rows);
        const durableRows = rowValues((await f.reopen()).rows);
        console.info(
          "[queued-authority]",
          JSON.stringify({
            surface,
            operation,
            invalidation: "editor-lifetime",
            predecessorPersistenceEntered: true,
            sdkQueueEntered: true,
            rejected: result.status === "rejected",
            expectedRows: expected,
            liveRows,
            durableRows,
            dirty: f.document.hasUnsavedLocalEdits(),
          }),
        );
        expect(result.status).toBe("rejected");
        expect({ liveRows, durableRows }).toEqual({
          liveRows: expected,
          durableRows: expected,
        });
      } finally {
        await f.close();
      }
    });
  }

  for (const lifetime of ["original", "retry"] as const) {
    test(`${surface}: an expired ${lifetime} caller cannot flush an address waiting in the SDK queue`, async () => {
      const f = await createQueuedAuthorityHarness(surface);
      let originalActive = true;
      let retryActive = true;
      try {
        const intent = {};
        f.fail();
        const failed = await f.actions
          .onAddAddress(retryFields, intent, () => originalActive)
          .then(
            () => null,
            (error: unknown) => error,
          );
        expect(failed).toBeInstanceOf(Error);
        expect(f.document.hasUnsavedLocalEdits()).toBe(true);
        expect((await f.reopen()).rows).toEqual([]);
        await f.blockPredecessor(true);
        const { settlement } = await f.enqueue("flush", () =>
          f.actions.onAddAddress(retryFields, intent, () => retryActive),
        );
        if (lifetime === "original") originalActive = false;
        else retryActive = false;
        f.release();
        const result = await settlement;
        const liveRows = rowValues(f.document.getSnapshot().rows);
        const durableRows = rowValues((await f.reopen()).rows);
        const dirty = f.document.hasUnsavedLocalEdits();
        console.info(
          "[queued-authority]",
          JSON.stringify({
            surface,
            operation: "retry-flush",
            invalidation: `${lifetime}-lifetime`,
            predecessorPersistenceEntered: true,
            sdkQueueEntered: true,
            rejected: result.status === "rejected",
            liveRows,
            durableRows,
            dirty,
          }),
        );
        expect(result.status).toBe("rejected");
        // The earlier failed attempt already changed live Loro; this stale retry
        // must not make that previously non-durable delta durable.
        expect({ durableRows, dirty }).toEqual({
          durableRows: [],
          dirty: true,
        });
      } finally {
        await f.close();
      }
    });
  }
}

test("the no-op predecessor alone leaves a failed address non-durable", async () => {
  const f = await createQueuedAuthorityHarness("contacts");
  try {
    f.fail();
    const error = await f.actions.onAddAddress(retryFields).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Error);
    expect(f.document.hasUnsavedLocalEdits()).toBe(true);
    expect((await f.reopen()).rows).toEqual([]);
    await f.blockPredecessor(true);
    await f.releaseAndDrain();
    const durableRows = rowValues((await f.reopen()).rows);
    const dirty = f.document.hasUnsavedLocalEdits();
    console.info(
      "[queued-authority]",
      JSON.stringify({
        surface: "contacts",
        operation: "predecessor-only-control",
        predecessorPersistenceEntered: true,
        durableRows,
        dirty,
      }),
    );
    expect({ durableRows, dirty }).toEqual({ durableRows: [], dirty: true });
  } finally {
    await f.close();
  }
});

for (const invalidation of ["write-scope", "read-only", "unmount"] as const) {
  test(`explorer: ${invalidation} prevents a queued address add`, async () => {
    const f = await createQueuedAuthorityHarness("explorer");
    try {
      await f.blockPredecessor();
      const { settlement } = await f.enqueue("add", () =>
        f.actions.onAddAddress(retryFields),
      );
      if (invalidation === "write-scope") f.changeWriteScope();
      else if (invalidation === "read-only") f.makeReadOnly();
      else f.hook?.unmount();
      f.release();
      const result = await settlement;
      const liveRows = rowValues(f.document.getSnapshot().rows);
      const durableRows = rowValues((await f.reopen()).rows);
      console.info(
        "[queued-authority]",
        JSON.stringify({
          surface: "explorer",
          operation: "add",
          invalidation,
          predecessorPersistenceEntered: true,
          sdkQueueEntered: true,
          rejected: result.status === "rejected",
          liveRows,
          durableRows,
          dirty: f.document.hasUnsavedLocalEdits(),
        }),
      );
      expect(result.status).toBe("rejected");
      expect({ liveRows, durableRows }).toEqual({
        liveRows: [],
        durableRows: [],
      });
    } finally {
      await f.close();
    }
  });
}
