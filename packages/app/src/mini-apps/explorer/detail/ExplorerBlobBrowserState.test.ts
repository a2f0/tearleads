import { expect, test } from "bun:test";
import {
  getBlobInfoWindowRange,
  getNextBlobInfoSort,
} from "./ExplorerBlobBrowserState";

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

test("blob info window range follows row height with overscan", () => {
  expect(getBlobInfoWindowRange({ scrollTop: 0, viewportHeight: 0 })).toEqual({
    limit: 24,
    offset: 0,
  });
  expect(
    getBlobInfoWindowRange({ scrollTop: 720, viewportHeight: 360 }),
  ).toEqual({
    limit: 26,
    offset: 12,
  });
  expect(
    getBlobInfoWindowRange({ scrollTop: Number.NaN, viewportHeight: -1 }),
  ).toEqual({
    limit: 24,
    offset: 0,
  });
});
