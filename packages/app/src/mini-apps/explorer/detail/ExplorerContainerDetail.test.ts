import { expect, test } from "bun:test";
import { getNextExplorerItemSort } from "./ExplorerContainerDetail";

test("container item sort toggles the active column and initializes new columns", () => {
  expect(
    getNextExplorerItemSort({ direction: "asc", key: "name" }, "name"),
  ).toEqual({
    direction: "desc",
    key: "name",
  });

  expect(
    getNextExplorerItemSort({ direction: "desc", key: "modified" }, "name"),
  ).toEqual({
    direction: "asc",
    key: "name",
  });

  expect(
    getNextExplorerItemSort({ direction: "desc", key: "name" }, "type"),
  ).toEqual({
    direction: "asc",
    key: "type",
  });

  expect(
    getNextExplorerItemSort({ direction: "asc", key: "name" }, "modified"),
  ).toEqual({
    direction: "desc",
    key: "modified",
  });
});
