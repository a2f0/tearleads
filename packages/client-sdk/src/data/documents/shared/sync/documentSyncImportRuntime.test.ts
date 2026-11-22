import { expect, test } from "bun:test";
import {
  createDocument,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { validateDocumentSyncUpdateImports } from "./documentSyncImportVerdicts";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";
import {
  LoroRuntimeFailureLedger,
  MAX_LORO_RUNTIME_ATTEMPTS,
} from "./loroRuntimeFailureLedger";

const ids = {
  after: "550e8400-e29b-41d4-a716-446655440b03",
  before: "550e8400-e29b-41d4-a716-446655440b01",
  other: "550e8400-e29b-41d4-a716-446655440b04",
  trap: "550e8400-e29b-41d4-a716-446655440b02",
};

async function honest(
  id: string,
  text: string,
): Promise<DecryptedDocumentSyncUpdate> {
  const source = await createDocument(`runtime-${id}`);
  source.getText("text").update(text);
  source.commit();
  const data = exportUpdatesSince(source, undefined);
  source.free();
  return { id, ...getUpdateVersionVectors(data), updateData: data };
}

/**
 * An honest update whose payload traps the Loro runtime while `armed`, from
 * its `fromRead`th read on: the first read is the metadata check, the second
 * the import's. `reads` counts every read, so a test can tell it was left
 * alone.
 */
async function trapping(id: string, fromRead = 1) {
  const update = await honest(id, `trapping ${id}`);
  const trap = { armed: true, reads: 0 };
  const { updateData, ...rest } = update;
  const trapped: DecryptedDocumentSyncUpdate = {
    ...rest,
    get updateData() {
      trap.reads += 1;
      if (trap.armed && trap.reads >= fromRead) {
        throw new WebAssembly.RuntimeError("unreachable");
      }
      return updateData;
    },
  };
  return { trap, update: trapped };
}

function clock() {
  const time = { now: 0 };
  return { ledger: new LoroRuntimeFailureLedger(() => time.now), time };
}

async function judge(input: {
  readonly ledger: LoroRuntimeFailureLedger;
  readonly page: readonly DecryptedDocumentSyncUpdate[];
  readonly runtimeAttempts?: ReadonlyMap<string, number>;
}) {
  const current = await createDocument("runtime-reader");
  try {
    const verdicts = await validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: input.page,
      runtimeAttempts: input.runtimeAttempts,
      runtimeLedger: input.ledger,
    });
    return {
      ...verdicts,
      failures: verdicts.runtimeFailures.map(
        ({ attempts, counted, final, updateId }) => ({
          attempts,
          counted,
          final,
          updateId,
        }),
      ),
      voidedIds: verdicts.voided.map((entry) => entry.updateId),
    };
  } finally {
    current.free();
  }
}

test("a runtime failure holds its update and every later one, and counts one attempt", async () => {
  const { trap, update } = await trapping(ids.trap);
  const verdicts = await judge({
    ledger: clock().ledger,
    page: [
      await honest(ids.before, "before"),
      update,
      await honest(ids.after, "after"),
    ],
  });
  expect(verdicts.voidedIds).toEqual([]);
  expect(verdicts.heldUpdateIds).toEqual([ids.trap, ids.after]);
  expect(verdicts.deferredUpdateIds).toEqual([]);
  expect(verdicts.failures).toEqual([
    { attempts: 1, counted: true, final: false, updateId: ids.trap },
  ]);
  expect(trap.reads).toBe(1);
});

test("a runtime failure in the import is held too, never voided", async () => {
  const { update } = await trapping(ids.trap, 2);
  const verdicts = await judge({ ledger: clock().ledger, page: [update] });
  expect(verdicts.voidedIds).toEqual([]);
  expect(verdicts.heldUpdateIds).toEqual([ids.trap]);
  expect(verdicts.failures).toEqual([
    { attempts: 1, counted: true, final: false, updateId: ids.trap },
  ]);
});

test("in one process the update waits out its retry delay, and failing again does not count", async () => {
  const { ledger, time } = clock();
  const { trap, update } = await trapping(ids.trap);
  const page = [update, await honest(ids.after, "after")];
  await judge({ ledger, page });
  const runtimeAttempts = new Map([[ids.trap, 1]]);

  // Within the delay it is not read again at all.
  const waiting = await judge({ ledger, page, runtimeAttempts });
  expect(waiting.heldUpdateIds).toEqual([ids.trap, ids.after]);
  expect(waiting.failures).toEqual([]);
  expect(trap.reads).toBe(1);

  time.now = 60_000;
  const retried = await judge({ ledger, page, runtimeAttempts });
  expect(trap.reads).toBe(2);
  expect(retried.heldUpdateIds).toEqual([ids.trap, ids.after]);
  expect(retried.failures).toEqual([
    { attempts: 1, counted: false, final: false, updateId: ids.trap },
  ]);

  // The delay doubled, so a retry one minute on still waits.
  time.now = 120_000;
  expect((await judge({ ledger, page, runtimeAttempts })).failures).toEqual([]);
  expect(trap.reads).toBe(2);
});

test("after one update's runtime failure, another's in the same process does not count", async () => {
  const { ledger } = clock();
  await judge({ ledger, page: [(await trapping(ids.trap)).update] });
  const second = await judge({
    ledger,
    page: [(await trapping(ids.other)).update],
  });
  expect(second.failures).toEqual([
    { attempts: 0, counted: false, final: false, updateId: ids.other },
  ]);
  expect(second.heldUpdateIds).toEqual([ids.other]);
});

test("an update is void once enough process lifetimes have each failed it, and the page goes on", async () => {
  const { update } = await trapping(ids.trap);
  const verdicts = await judge({
    // A new process: this ledger has seen no failure yet.
    ledger: clock().ledger,
    page: [update, await honest(ids.after, "after")],
    runtimeAttempts: new Map([[ids.trap, MAX_LORO_RUNTIME_ATTEMPTS - 1]]),
  });
  expect(verdicts.voidedIds).toEqual([ids.trap]);
  expect(verdicts.voided[0]?.stage).toBe("loro_runtime");
  expect(verdicts.heldUpdateIds).toEqual([]);
  expect(verdicts.failures).toEqual([
    {
      attempts: MAX_LORO_RUNTIME_ATTEMPTS,
      counted: true,
      final: true,
      updateId: ids.trap,
    },
  ]);
});

test("an unsettled update that imports on a later attempt joins", async () => {
  const { trap, update } = await trapping(ids.trap);
  trap.armed = false;
  const verdicts = await judge({
    ledger: clock().ledger,
    page: [update, await honest(ids.after, "after")],
    runtimeAttempts: new Map([[ids.trap, MAX_LORO_RUNTIME_ATTEMPTS - 1]]),
  });
  expect(verdicts.voidedIds).toEqual([]);
  expect(verdicts.heldUpdateIds).toEqual([]);
  expect(verdicts.failures).toEqual([]);
});
