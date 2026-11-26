import { expect, test } from "bun:test";
import { resolveDocumentHistoryStopProvenance } from "./documentHistoryProvenance";

/** A stop holding operations 10 to 19 of peer 7. */
const STOP = { endCounter: 20, peerId: "7", startCounter: 10 };

function range(
  startCounter: number,
  endCounter: number,
  authorityKind: "baseline" | "direct" = "direct",
  peerId = "7",
) {
  return { authorityKind, endCounter, peerId, startCounter };
}

test("a stop every operation of which a signed upload carried is direct", () => {
  expect(resolveDocumentHistoryStopProvenance([range(0, 30)], STOP)).toBe(
    "direct",
  );
  // Several uploads that together cover it, in any order.
  expect(
    resolveDocumentHistoryStopProvenance(
      [range(15, 20), range(0, 12), range(12, 15)],
      STOP,
    ),
  ).toBe("direct");
});

test("a stop any operation of which only a snapshot carried is baseline", () => {
  expect(
    resolveDocumentHistoryStopProvenance([range(0, 30, "baseline")], STOP),
  ).toBe("baseline");
  // One operation in the middle is enough: the stop is not all signed
  // uploads.
  expect(
    resolveDocumentHistoryStopProvenance(
      [range(10, 14), range(14, 15, "baseline"), range(15, 20)],
      STOP,
    ),
  ).toBe("baseline");
});

test("a stop the server holds no operation of is absent", () => {
  expect(resolveDocumentHistoryStopProvenance([], STOP)).toBe("absent");
  // Ranges that end where it starts, start where it ends, or belong to
  // another peer do not hold it.
  expect(
    resolveDocumentHistoryStopProvenance(
      [range(0, 10), range(20, 30), range(10, 20, "direct", "8")],
      STOP,
    ),
  ).toBe("absent");
});

test("a stop the server holds only part of is partial", () => {
  // Its start, its end, and a hole in its middle.
  for (const ranges of [
    [range(0, 15)],
    [range(15, 30)],
    [range(10, 14), range(16, 20)],
    [range(10, 14, "baseline")],
  ]) {
    expect(resolveDocumentHistoryStopProvenance(ranges, STOP)).toBe("partial");
  }
});
