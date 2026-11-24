import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import {
  createLoroWindowBench,
  device,
  FIRST,
  honest,
  SECOND,
} from "../../../../test/helpers/workflows/loroWindowBench";
import type { DecryptedDocumentSyncUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import { LoroRuntimeFailureLedger } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import {
  createDocumentSyncLoroWindow,
  runDocumentSyncLoroWork,
  settleDocumentSyncLoroWindow,
} from "./loroPassWindow";

const bench = createLoroWindowBench();
const { judgeIn, recordedAttempts } = bench;

beforeEach(async () => {
  await bench.open();
});

afterEach(() => bench.close());

// A window the process outlived read its updates without dying, so the
// deaths counted toward them before were not theirs: its close clears
// their attempts, whether or not a save accepted them, and deaths months
// apart cannot add up to a void (#3194).
test("a window's close clears the attempts of the updates it read", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  for (const lifetime of ["dead-1", "dead-2"]) {
    await judgeIn(host.lifetime(lifetime), [update]);
    host.kill(lifetime);
  }
  const survivor = host.lifetime("survivor");
  const window = createDocumentSyncLoroWindow();
  await judgeIn(survivor, [update], new LoroRuntimeFailureLedger(), undefined, {
    window,
  });
  expect(await recordedAttempts(FIRST)).toBe(2);

  // The page's save never ran: the pass settles its window unsaved.
  await settleDocumentSyncLoroWindow(window, null);

  expect(await recordedAttempts(FIRST)).toBeNull();
});

// A death in a window covering two updates names neither: it isolates
// them and counts nothing. The window that then reads one alone and closes
// clears only that update's attempts.
test("a close clears only the updates its window read", async () => {
  const host = device();
  const first = await honest(FIRST);
  const second = await honest(SECOND);
  for (const [lifetime, update] of [
    ["dead-first", first.update],
    ["dead-second", second.update],
  ] as const) {
    await judgeIn(host.lifetime(lifetime), [update]);
    host.kill(lifetime);
  }
  const window = createDocumentSyncLoroWindow();
  await judgeIn(
    host.lifetime("survivor"),
    [first.update],
    new LoroRuntimeFailureLedger(),
    undefined,
    { window },
  );
  await settleDocumentSyncLoroWindow(window, null);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await recordedAttempts(SECOND)).toBe(1);
});

/** An update whose payload traps the Loro runtime on every read. */
async function trapping(id: string): Promise<DecryptedDocumentSyncUpdate> {
  const source = await createDocument(`trapping-${id}`);
  source.getText("text").update(id);
  source.commit();
  const data = exportUpdatesSince(source, undefined);
  source.free();
  return {
    id,
    ...getUpdateVersionVectors(data),
    get updateData(): Uint8Array {
      throw new WebAssembly.RuntimeError("unreachable");
    },
  };
}

// The runtime failing on an update inside the window is an attempt the
// window recorded, not one it outlived: its close keeps it, so failures in
// one process still add up to a void.
test("a close keeps the attempt the runtime failed on inside it", async () => {
  const host = device();
  const window = createDocumentSyncLoroWindow();
  await judgeIn(
    host.lifetime("failing"),
    [await trapping(FIRST)],
    new LoroRuntimeFailureLedger(),
    undefined,
    { window },
  );
  expect(await recordedAttempts(FIRST)).toBe(1);

  await settleDocumentSyncLoroWindow(window, null);

  expect(await recordedAttempts(FIRST)).toBe(1);
});

// The judge read the update and survived, but the page's Loro work after
// it, a live import or a rebuild, failed: the window did not end cleanly,
// so its close keeps the attempts deaths counted toward what it read.
test("a close after the page's Loro work failed keeps the attempts", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  for (const lifetime of ["dead-1", "dead-2"]) {
    await judgeIn(host.lifetime(lifetime), [update]);
    host.kill(lifetime);
  }
  const window = createDocumentSyncLoroWindow();
  await judgeIn(
    host.lifetime("survivor"),
    [update],
    new LoroRuntimeFailureLedger(),
    undefined,
    { window },
  );
  expect(() =>
    runDocumentSyncLoroWork(window, () => {
      throw new WebAssembly.RuntimeError("unreachable");
    }),
  ).toThrow("unreachable");

  await settleDocumentSyncLoroWindow(window, null);

  expect(await recordedAttempts(FIRST)).toBe(2);
});
