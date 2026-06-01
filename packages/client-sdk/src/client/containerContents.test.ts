import { expect, test } from "bun:test";
import { syncedContainerDocumentObjectSyncState } from "../workflows/container-contents/syncState";
import { listUserContainerIdsForDocumentRefresh } from "./containerContents";

test("document refresh skips app-owned system containers", () => {
  expect(
    listUserContainerIdsForDocumentRefresh({
      ready: true,
      nodes: [
        {
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "organization-1",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
        {
          id: "profile-container",
          kind: "container",
          name: "Profile",
          organizationId: "organization-1",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    }),
  ).toEqual(["root-container"]);
});

test("document refresh falls back when the container snapshot is not ready", () => {
  expect(
    listUserContainerIdsForDocumentRefresh({
      ready: false,
      nodes: [],
    }),
  ).toBeNull();
});

test("document refresh treats nullish ready snapshot nodes as empty", () => {
  expect(
    listUserContainerIdsForDocumentRefresh({
      ready: true,
      nodes: null,
    }),
  ).toEqual([]);
  expect(
    listUserContainerIdsForDocumentRefresh({
      ready: true,
    }),
  ).toEqual([]);
});
