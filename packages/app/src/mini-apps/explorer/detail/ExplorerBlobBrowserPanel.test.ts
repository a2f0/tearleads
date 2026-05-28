import { expect, test } from "bun:test";
import { getNextBlobInfoSort } from "./ExplorerBlobBrowserPanel";

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
