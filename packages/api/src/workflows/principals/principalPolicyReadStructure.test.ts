import { expect, test } from "bun:test";
import {
  ancestorsOrSelf,
  selectCandidateContainerIds,
} from "./principalPolicyReadStructure";

// root ─ shared ─ child ─ leaf ; other is a separate root.
const tree = new Map<string, string | null>([
  ["root", null],
  ["shared", "root"],
  ["child", "shared"],
  ["leaf", "child"],
  ["other", null],
]);

test("a seed at or below a referencing container is a candidate", () => {
  expect(
    selectCandidateContainerIds({
      parentById: tree,
      referencing: ["shared"],
      seeds: ["leaf", "other"],
    }),
  ).toEqual(["leaf"]);
  expect(
    selectCandidateContainerIds({
      parentById: tree,
      referencing: ["shared"],
      seeds: ["shared"],
    }),
  ).toEqual(["shared"]);
});

test("a referencing container at or below a seed is a candidate", () => {
  expect(
    selectCandidateContainerIds({
      parentById: tree,
      referencing: ["child", "other"],
      seeds: ["root"],
    }),
  ).toEqual(["child"]);
});

test("containers on unrelated paths never become candidates", () => {
  expect(
    selectCandidateContainerIds({
      parentById: tree,
      referencing: ["other"],
      seeds: ["leaf"],
    }),
  ).toEqual([]);
  expect(
    selectCandidateContainerIds({
      parentById: tree,
      referencing: [],
      seeds: ["root"],
    }),
  ).toEqual([]);
});

test("both directions combine and dedupe, sorted by id", () => {
  expect(
    selectCandidateContainerIds({
      parentById: tree,
      referencing: ["root", "leaf"],
      seeds: ["shared", "leaf"],
    }),
  ).toEqual(["leaf", "shared"]);
});

test("an ancestor walk survives a cycle and an unknown parent", () => {
  const cyclic = new Map<string, string | null>([
    ["a", "b"],
    ["b", "a"],
  ]);
  expect(ancestorsOrSelf("a", cyclic)).toEqual(["a", "b"]);
  expect(ancestorsOrSelf("orphan", tree)).toEqual(["orphan"]);
  expect(ancestorsOrSelf("leaf", tree)).toEqual([
    "leaf",
    "child",
    "shared",
    "root",
  ]);
});
