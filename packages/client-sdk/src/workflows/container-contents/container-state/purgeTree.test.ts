import { describe, expect, test } from "bun:test";
import type { ContainerState } from "../remoteHydration";
import { classifySubtreeDocument, collectSubtreeLeafFirst } from "./purgeTree";

function containerState(id: string, parentId: string | null): ContainerState {
  // Only the fields the subtree walk reads are populated; the rest of
  // ContainerState is irrelevant to ordering.
  return {
    container: { id, parentId },
  } as unknown as ContainerState;
}

function containersById(
  states: ReadonlyArray<ContainerState>,
): ReadonlyMap<string, ContainerState> {
  return new Map(states.map((state) => [state.container.id, state]));
}

describe("collectSubtreeLeafFirst", () => {
  test("returns the root last so containers delete leaf-first", () => {
    // root -> a -> a1, a -> a2; b under root
    const map = containersById([
      containerState("root", null),
      containerState("a", "root"),
      containerState("a1", "a"),
      containerState("a2", "a"),
      containerState("b", "root"),
    ]);

    const order = collectSubtreeLeafFirst(map, "root").map(
      (state) => state.container.id,
    );

    // Every child must appear before its parent.
    expect(order.indexOf("a1")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("a2")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("root"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("root"));
    expect(order.at(-1)).toBe("root");
    expect(order).toHaveLength(5);
  });

  test("collects only the targeted subtree, not unrelated containers", () => {
    const map = containersById([
      containerState("root", null),
      containerState("trash", "root"),
      containerState("trashed", "trash"),
      containerState("trashed-child", "trashed"),
      containerState("other", "root"),
    ]);

    const order = collectSubtreeLeafFirst(map, "trashed").map(
      (state) => state.container.id,
    );

    expect(order).toEqual(["trashed-child", "trashed"]);
    expect(order).not.toContain("trash");
    expect(order).not.toContain("other");
  });

  test("tolerates a cyclic parent chain without looping forever", () => {
    const map = containersById([
      containerState("x", "y"),
      containerState("y", "x"),
    ]);

    const order = collectSubtreeLeafFirst(map, "x").map(
      (state) => state.container.id,
    );

    // Both are visited once; the cycle guard prevents re-enqueue.
    expect(new Set(order)).toEqual(new Set(["x", "y"]));
  });
});

describe("classifySubtreeDocument", () => {
  const subtreeContainerIds = new Set(["trashed", "trashed-child"]);

  test("purges a synced document linked only inside the subtree", () => {
    expect(
      classifySubtreeDocument({
        documentId: "doc-1",
        linkedContainerIds: ["trashed"],
        subtreeContainerIds,
      }),
    ).toEqual({ kind: "purge" });
  });

  test("purges a synced document even when linked to several in-subtree folders", () => {
    expect(
      classifySubtreeDocument({
        documentId: "doc-1",
        linkedContainerIds: ["trashed", "trashed-child"],
        subtreeContainerIds,
      }),
    ).toEqual({ kind: "purge" });
  });

  test("unlinks (preserves) a document also linked outside the subtree", () => {
    // The user's requirement: a document kept in another folder must NOT be
    // destroyed — only unlinked from the trashed subtree.
    expect(
      classifySubtreeDocument({
        documentId: "doc-1",
        linkedContainerIds: ["trashed", "keep-me"],
        subtreeContainerIds,
      }),
    ).toEqual({ kind: "unlink", containerIds: ["trashed"] });
  });

  test("unlink only targets the in-subtree containers, never the external ones", () => {
    expect(
      classifySubtreeDocument({
        documentId: "doc-1",
        linkedContainerIds: ["trashed", "trashed-child", "keep-a", "keep-b"],
        subtreeContainerIds,
      }),
    ).toEqual({
      kind: "unlink",
      containerIds: ["trashed", "trashed-child"],
    });
  });

  test("purges a never-synced document locally", () => {
    expect(
      classifySubtreeDocument({
        documentId: null,
        linkedContainerIds: [],
        subtreeContainerIds,
      }),
    ).toEqual({ kind: "purge-local" });
  });
});
