import { describe, expect, test } from "bun:test";
import { parsePatchAnchors } from "./diffAnchors";

describe("parsePatchAnchors", () => {
  test("records added and context lines on the new side", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " context-a",
      "+added-b",
      " context-c",
      "+added-d",
    ].join("\n");
    const anchors = parsePatchAnchors(patch);
    expect([...anchors.added].sort((a, b) => a - b)).toEqual([2, 4]);
    expect([...anchors.context].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  test("deletions do not advance the new-side counter", () => {
    const patch = ["@@ -10,3 +10,2 @@", " keep", "-gone", "+replacement"].join(
      "\n",
    );
    const anchors = parsePatchAnchors(patch);
    // keep -> 10, replacement -> 11; the deleted line never consumes a new-side number.
    expect([...anchors.context]).toEqual([10]);
    expect([...anchors.added]).toEqual([11]);
  });

  test("tracks line numbers across multiple hunks", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      "+first",
      "@@ -20,1 +50,1 @@",
      "+later",
    ].join("\n");
    const anchors = parsePatchAnchors(patch);
    expect([...anchors.added].sort((a, b) => a - b)).toEqual([1, 50]);
  });

  test("ignores the no-newline marker", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      "+only",
      "\\ No newline at end of file",
    ].join("\n");
    const anchors = parsePatchAnchors(patch);
    expect([...anchors.added]).toEqual([1]);
    expect(anchors.context.size).toBe(0);
  });

  test("ignores a trailing empty line from a newline-terminated patch", () => {
    const patch = `${["@@ -1,1 +1,2 @@", " keep", "+added"].join("\n")}\n`;
    const anchors = parsePatchAnchors(patch);
    expect([...anchors.context]).toEqual([1]);
    expect([...anchors.added]).toEqual([2]);
    // The trailing "" must not become a phantom anchor at line 3.
    expect(anchors.context.has(3)).toBe(false);
    expect(anchors.added.has(3)).toBe(false);
  });
});
