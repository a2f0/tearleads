import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createLoroWindowBench,
  device,
  FIRST,
  honest,
  SECOND,
} from "../../../../test/helpers/workflows/loroWindowBench";
import { LoroRuntimeFailureLedger } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import {
  createDocumentSyncLoroWindow,
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
