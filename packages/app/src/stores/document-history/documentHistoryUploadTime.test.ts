import { expect, test } from "bun:test";
import {
  boundDocumentHistoryStopTime,
  DOCUMENT_HISTORY_CLOCK_AHEAD_NOTICE_MS,
  resolveDocumentHistoryStopUploadedAt,
} from "./documentHistoryUploadTime";

const FIRST_UPLOAD = "2030-01-01T10:00:00.000Z";
const SECOND_UPLOAD = "2030-01-01T11:00:00.000Z";
const RANGES = [
  { createdAt: FIRST_UPLOAD, endCounter: 4, peerId: "7", startCounter: 0 },
  { createdAt: SECOND_UPLOAD, endCounter: 9, peerId: "7", startCounter: 4 },
  { createdAt: SECOND_UPLOAD, endCounter: 3, peerId: "8", startCounter: 0 },
];

test("a change is dated by the upload that delivered its first operation", () => {
  expect(
    resolveDocumentHistoryStopUploadedAt(RANGES, {
      peerId: "7",
      startCounter: 0,
    }),
  ).toBe(Date.parse(FIRST_UPLOAD));
  // A change that began in one upload and ran into the next began by the
  // first: its one time was taken at its first operation.
  expect(
    resolveDocumentHistoryStopUploadedAt(RANGES, {
      peerId: "7",
      startCounter: 3,
    }),
  ).toBe(Date.parse(FIRST_UPLOAD));
  // A range ends before its end counter.
  expect(
    resolveDocumentHistoryStopUploadedAt(RANGES, {
      peerId: "7",
      startCounter: 4,
    }),
  ).toBe(Date.parse(SECOND_UPLOAD));
  expect(
    resolveDocumentHistoryStopUploadedAt(RANGES, {
      peerId: "8",
      startCounter: 2,
    }),
  ).toBe(Date.parse(SECOND_UPLOAD));
});

test("a change no upload has delivered has no upload time", () => {
  // Not uploaded yet, another peer, or attribution unavailable.
  expect(
    resolveDocumentHistoryStopUploadedAt(RANGES, {
      peerId: "7",
      startCounter: 9,
    }),
  ).toBeNull();
  expect(
    resolveDocumentHistoryStopUploadedAt(RANGES, {
      peerId: "9",
      startCounter: 0,
    }),
  ).toBeNull();
  expect(
    resolveDocumentHistoryStopUploadedAt([], { peerId: "7", startCounter: 0 }),
  ).toBeNull();
  // A time that cannot be read bounds nothing.
  expect(
    resolveDocumentHistoryStopUploadedAt(
      [{ createdAt: "soon", endCounter: 4, peerId: "7", startCounter: 0 }],
      { peerId: "7", startCounter: 0 },
    ),
  ).toBeNull();
});

const UPLOADED = Date.parse(FIRST_UPLOAD);

test("a change made before its upload keeps the time it recorded", () => {
  expect(boundDocumentHistoryStopTime(UPLOADED - 5_000, UPLOADED)).toEqual({
    at: UPLOADED - 5_000,
    clockAhead: false,
  });
  // Written offline and uploaded a week later: still the device's time.
  const weekEarlier = UPLOADED - 7 * 24 * 60 * 60 * 1000;
  expect(boundDocumentHistoryStopTime(weekEarlier, UPLOADED)).toEqual({
    at: weekEarlier,
    clockAhead: false,
  });
  expect(boundDocumentHistoryStopTime(UPLOADED, UPLOADED)).toEqual({
    at: UPLOADED,
    clockAhead: false,
  });
});

test("a time past its upload is shown as the upload", () => {
  // A second ahead is an ordinary clock: corrected without comment.
  expect(boundDocumentHistoryStopTime(UPLOADED + 1_000, UPLOADED)).toEqual({
    at: UPLOADED,
    clockAhead: false,
  });
  expect(
    boundDocumentHistoryStopTime(
      UPLOADED + DOCUMENT_HISTORY_CLOCK_AHEAD_NOTICE_MS,
      UPLOADED,
    ),
  ).toEqual({ at: UPLOADED, clockAhead: false });
  // A day ahead is a wrong clock, and History says so.
  expect(
    boundDocumentHistoryStopTime(UPLOADED + 24 * 60 * 60 * 1000, UPLOADED),
  ).toEqual({ at: UPLOADED, clockAhead: true });
});

test("a change with only one of the two times shows what it has", () => {
  // Not uploaded, or attribution unavailable: the device's own time.
  expect(boundDocumentHistoryStopTime(UPLOADED + 999_999, null)).toEqual({
    at: UPLOADED + 999_999,
    clockAhead: false,
  });
  // No time recorded: an upload time is a bound, not the change's time.
  expect(boundDocumentHistoryStopTime(null, UPLOADED)).toEqual({
    at: null,
    clockAhead: false,
  });
  expect(boundDocumentHistoryStopTime(null, null)).toEqual({
    at: null,
    clockAhead: false,
  });
});
