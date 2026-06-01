import { expect, test } from "bun:test";
import { listContainerParentIdsForEventHydration } from "./containerEvents";

test("container mutation events mark changed parent and child hydration lanes", () => {
  expect(
    listContainerParentIdsForEventHydration([
      {
        type: "container_mutation_created",
        containerId: "container-1",
        eventType: "container.create",
        parentId: "parent-1",
      },
      {
        type: "container_mutation_created",
        containerId: "container-2",
        eventType: "container.grant",
        parentId: null,
      },
    ]),
  ).toEqual(["parent-1", "container-1", null, "container-2"]);
});

test("container move events mark previous parent hydration lanes", () => {
  expect(
    listContainerParentIdsForEventHydration([
      {
        type: "container_mutation_created",
        containerId: "container-1",
        eventType: "container.move",
        parentId: "new-parent",
        previousParentId: "old-parent",
      },
    ]),
  ).toEqual([null, "new-parent", "container-1", "old-parent"]);
});

test("container mutation hydration ignores same-signer events", () => {
  expect(
    listContainerParentIdsForEventHydration(
      [
        {
          type: "container_mutation_created",
          containerId: "container-1",
          eventType: "container.grant",
          parentId: null,
          signerKeyFingerprint: "local-signer",
        },
      ],
      { ignoredSignerKeyFingerprint: "local-signer" },
    ),
  ).toEqual([]);
});

test("container mutation hydration ignores malformed events", () => {
  expect(
    listContainerParentIdsForEventHydration([
      { type: "document_update_created", documentId: "document-1" },
      { type: "container_mutation_created", containerId: "", parentId: null },
      {
        type: "container_mutation_created",
        containerId: "container-1",
        parentId: 42,
      },
      null,
    ]),
  ).toEqual([]);
});
