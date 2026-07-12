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

test("container mutation hydration reconciles a same-identity create", () => {
  // A sibling peer of the same identity signs container mutations with the same
  // seed-derived key, so the event carries this client's own signing
  // fingerprint. It must STILL produce hydration lanes: the authoring session is
  // excluded server-side via the event's `origin`, and every other same-identity
  // peer only discovers the new folder by re-listing the parent here. Suppressing
  // by signer fingerprint dropped sibling creates and left new folders invisible.
  expect(
    listContainerParentIdsForEventHydration([
      {
        type: "container_mutation_created",
        containerId: "container-1",
        eventType: "container.create",
        parentId: "parent-1",
        signerKeyFingerprint: "local-signer",
      },
    ]),
  ).toEqual(["parent-1", "container-1"]);
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
