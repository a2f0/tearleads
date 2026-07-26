import { expect, test } from "bun:test";
import { getNextBlobInfoSort } from "./blobListState";

test("blob info sort toggles the active column and initializes MIME ascending", () => {
  expect(
    getNextBlobInfoSort({ direction: "desc", key: "updated" }, "mimeType"),
  ).toEqual({
    direction: "asc",
    key: "mimeType",
  });

  expect(
    getNextBlobInfoSort({ direction: "asc", key: "mimeType" }, "mimeType"),
  ).toEqual({
    direction: "desc",
    key: "mimeType",
  });

  expect(
    getNextBlobInfoSort({ direction: "asc", key: "mimeType" }, "updated"),
  ).toEqual({
    direction: "desc",
    key: "updated",
  });
});

test("blob info sort initializes byte length descending and toggles", () => {
  expect(
    getNextBlobInfoSort({ direction: "desc", key: "updated" }, "byteLength"),
  ).toEqual({
    direction: "desc",
    key: "byteLength",
  });

  expect(
    getNextBlobInfoSort({ direction: "desc", key: "byteLength" }, "byteLength"),
  ).toEqual({
    direction: "asc",
    key: "byteLength",
  });
});
