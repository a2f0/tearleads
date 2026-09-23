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

test("a hint whose parents were withheld hydrates only the lanes it names", () => {
  // The server scopes each hint to the recipient's interest: a watcher of only
  // the moved container learns neither parent, and a watcher of only the
  // destination never learns the source.
  expect(
    listContainerParentIdsForEventHydration([
      {
        type: "container_mutation_created",
        containerId: "container-1",
        eventType: "container.move",
      },
      {
        type: "container_mutation_created",
        containerId: "container-2",
        eventType: "container.create",
        parentId: "destination",
      },
    ]),
  ).toEqual([null, "container-1", "destination", "container-2"]);
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

test("generic child changes hydrate only the listed parent lanes", () => {
  expect(
    listContainerParentIdsForEventHydration([
      {
        type: "container_children_changed",
        containerIds: ["source", "destination", "source"],
      },
      { type: "container_children_changed", containerIds: ["", null, 7] },
      { type: "container_children_changed" },
    ]),
  ).toEqual(["source", "destination"]);
});
