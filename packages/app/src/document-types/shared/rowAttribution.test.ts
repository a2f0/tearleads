import { expect, test } from "bun:test";
import { formatRowAttribution } from "./rowAttribution";

const AT = "2026-07-16T08:30:00.000Z";

test("returns null when the row has no timestamp", () => {
  expect(
    formatRowAttribution({
      currentAuthorId: "u",
      updatedAt: "",
      updatedBy: "u",
    }),
  ).toBeNull();
});

test("omits authorship when the writer is unknown", () => {
  expect(
    formatRowAttribution({
      currentAuthorId: null,
      updatedAt: AT,
      updatedBy: "",
    }),
  ).toBe("Updated 2026-07-16 08:30");
});

test("labels the local writer as you", () => {
  expect(
    formatRowAttribution({
      currentAuthorId: "user-alice",
      updatedAt: AT,
      updatedBy: "user-alice",
    }),
  ).toBe("Updated 2026-07-16 08:30 by you");
});

test("shows a short id verbatim for another writer", () => {
  expect(
    formatRowAttribution({
      currentAuthorId: "user-alice",
      updatedAt: AT,
      updatedBy: "user-bob",
    }),
  ).toBe("Updated 2026-07-16 08:30 by user-bob");
});

test("truncates a long signer id", () => {
  expect(
    formatRowAttribution({
      currentAuthorId: "me",
      updatedAt: AT,
      updatedBy: "0123456789abcdef",
    }),
  ).toBe("Updated 2026-07-16 08:30 by 01234567…");
});
