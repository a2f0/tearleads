import { expect, test } from "bun:test";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import { resolveDocumentHistoryStopWriter } from "./documentHistoryWriter";

type Segment = DocumentEditAttributionResponse["segments"][number];

function segment(overrides: Partial<Segment>): Segment {
  return {
    authorityKind: "direct",
    endCounter: 10,
    peerId: "7",
    startCounter: 0,
    writerKeyFingerprint: "fp-ada",
    writerUserId: "ada",
    ...overrides,
  };
}

const STOP = { endCounter: 6, peerId: "7", startCounter: 2 };

test("a stop inside one ordinary upload is credited to its signer", () => {
  expect(resolveDocumentHistoryStopWriter([segment({})], STOP)).toEqual({
    writerKeyFingerprint: "fp-ada",
    writerUserId: "ada",
  });
});

test("a stop spanning two uploads by the same signer is still credited", () => {
  expect(
    resolveDocumentHistoryStopWriter(
      [segment({ endCounter: 4 }), segment({ startCounter: 4 })],
      STOP,
    ),
  ).toEqual({ writerKeyFingerprint: "fp-ada", writerUserId: "ada" });
});

test("a stop with no covering segment stays unknown", () => {
  expect(resolveDocumentHistoryStopWriter([], STOP)).toBeNull();
  expect(
    resolveDocumentHistoryStopWriter([segment({ peerId: "8" })], STOP),
  ).toBeNull();
  // Only part of the stop has been uploaded.
  expect(
    resolveDocumentHistoryStopWriter([segment({ endCounter: 4 })], STOP),
  ).toBeNull();
});

test("a stop delivered by a rotation baseline stays unknown", () => {
  expect(
    resolveDocumentHistoryStopWriter(
      [segment({ authorityKind: "baseline" })],
      STOP,
    ),
  ).toBeNull();
  expect(
    resolveDocumentHistoryStopWriter(
      [
        segment({ endCounter: 4 }),
        segment({ authorityKind: "baseline", startCounter: 4 }),
      ],
      STOP,
    ),
  ).toBeNull();
});

test("a stop spanning two signing identities stays unknown", () => {
  expect(
    resolveDocumentHistoryStopWriter(
      [
        segment({ endCounter: 4 }),
        segment({
          startCounter: 4,
          writerKeyFingerprint: "fp-eve",
          writerUserId: "eve",
        }),
      ],
      STOP,
    ),
  ).toBeNull();
  // The same user on another device key is a different signing identity.
  expect(
    resolveDocumentHistoryStopWriter(
      [
        segment({ endCounter: 4 }),
        segment({ startCounter: 4, writerKeyFingerprint: "fp-ada-phone" }),
      ],
      STOP,
    ),
  ).toBeNull();
});

test("matching ends do not credit a stop whose middle someone else uploaded", () => {
  // Ada delivered the first and last operations; Eve delivered the middle.
  expect(
    resolveDocumentHistoryStopWriter(
      [
        segment({ endCounter: 3 }),
        segment({
          endCounter: 5,
          startCounter: 3,
          writerKeyFingerprint: "fp-eve",
          writerUserId: "eve",
        }),
        segment({ startCounter: 5 }),
      ],
      STOP,
    ),
  ).toBeNull();
});

test("matching ends do not credit a stop whose middle a baseline delivered", () => {
  expect(
    resolveDocumentHistoryStopWriter(
      [
        segment({ endCounter: 3 }),
        segment({ authorityKind: "baseline", endCounter: 5, startCounter: 3 }),
        segment({ startCounter: 5 }),
      ],
      STOP,
    ),
  ).toBeNull();
});

test("matching ends do not credit a stop with an unattributed middle", () => {
  // Operations 3 and 4 have no segment at all.
  expect(
    resolveDocumentHistoryStopWriter(
      [segment({ endCounter: 3 }), segment({ startCounter: 5 })],
      STOP,
    ),
  ).toBeNull();
});

test("segments in any order are read in operation order", () => {
  expect(
    resolveDocumentHistoryStopWriter(
      [segment({ startCounter: 4 }), segment({ endCounter: 4 })],
      STOP,
    ),
  ).toEqual({ writerKeyFingerprint: "fp-ada", writerUserId: "ada" });
});
