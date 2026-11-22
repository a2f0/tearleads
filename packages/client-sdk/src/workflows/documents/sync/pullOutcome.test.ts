import { expect, test } from "bun:test";
import { documentPullOutcome, withPullCompletion } from "./pullOutcome";

test("a deferral outranks a hold, and a hold ends a pull the server has more pages of", () => {
  const outcomes = [false, true].flatMap((deferred) =>
    [false, true].flatMap((held) =>
      [false, true].map((pullComplete) => [
        { deferred, held, pullComplete },
        documentPullOutcome({ deferred, held, pullComplete }),
      ]),
    ),
  );
  expect(outcomes).toEqual([
    [{ deferred: false, held: false, pullComplete: false }, "continues"],
    [{ deferred: false, held: false, pullComplete: true }, "complete"],
    [{ deferred: false, held: true, pullComplete: false }, "held"],
    [{ deferred: false, held: true, pullComplete: true }, "held"],
    [{ deferred: true, held: false, pullComplete: false }, "deferred"],
    [{ deferred: true, held: false, pullComplete: true }, "deferred"],
    [{ deferred: true, held: true, pullComplete: false }, "deferred"],
    [{ deferred: true, held: true, pullComplete: true }, "deferred"],
  ]);
});

/** A judged page's flags, before its pull's completion is known. */
function page(held: boolean, deferred: boolean) {
  return { hasHeldPull: held, hasIncompletePull: deferred };
}

test("a held page in a pull with more pages ends the pull without calling it incomplete", () => {
  expect(withPullCompletion(page(true, false), false)).toEqual(
    page(true, false),
  );
  expect(withPullCompletion(page(false, false), false)).toEqual(
    page(false, true),
  );
  expect(withPullCompletion(page(false, true), true)).toEqual(
    page(false, true),
  );
  expect(withPullCompletion(page(false, false), true)).toEqual(
    page(false, false),
  );
});
