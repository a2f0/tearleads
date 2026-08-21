import { expect, test } from "bun:test";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { resolveDeleteToTrashTarget } from "./systemContainerTrash";

const VIEWER_ORG = "viewer-org";
const VIEWER_ROOT = "viewer-root";
const OWNER_ORG = "owner-org";
const OWNER_ROOT = "owner-root";
const CUSTOM_ORG = "custom-org";
const CUSTOM_ROOT = "custom-root";
const VIEWER_TRASH_SLOT = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

// Viewer's own org tree (root, Trash, a folder) plus a foreign shared root owned
// by owner-org with no reachable Trash — enough to exercise every branch of the
// resolve + lazy-ensure + no-op-under-trash core.
const baseNodes = [
  {
    id: VIEWER_ROOT,
    kind: "container" as const,
    name: "/",
    organizationId: VIEWER_ORG,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "viewer-trash",
    kind: "container" as const,
    name: "Trash",
    organizationId: VIEWER_ORG,
    parentId: VIEWER_ROOT,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: VIEWER_TRASH_SLOT,
  },
  {
    id: "viewer-folder",
    kind: "container" as const,
    name: "Notes",
    organizationId: VIEWER_ORG,
    parentId: VIEWER_ROOT,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: OWNER_ROOT,
    kind: "container" as const,
    name: "/",
    organizationId: OWNER_ORG,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "owner-folder",
    kind: "container" as const,
    name: "Shared",
    organizationId: OWNER_ORG,
    parentId: OWNER_ROOT,
    syncState: syncedContainerDocumentObjectSyncState,
  },
];

const nodesWithCollidingCustomTrash = [
  {
    id: CUSTOM_ROOT,
    kind: "container" as const,
    name: "/",
    organizationId: CUSTOM_ORG,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "custom-trash",
    kind: "container" as const,
    name: "Trash",
    organizationId: CUSTOM_ORG,
    parentId: CUSTOM_ROOT,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: VIEWER_TRASH_SLOT,
  },
  ...baseNodes,
];

function ensureSpy(result: { id: string } | null) {
  let calls = 0;
  return {
    ensure: () => {
      calls += 1;
      return Promise.resolve(result);
    },
    get calls() {
      return calls;
    },
  };
}

test("resolves the viewer's own Trash without lazily creating one when it exists", async () => {
  const spy = ensureSpy({ id: "should-not-be-used" });

  expect(
    await resolveDeleteToTrashTarget({
      containerId: "viewer-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: baseNodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
      ensureOwnTrashContainer: spy.ensure,
    }),
  ).toBe("viewer-trash");
  expect(spy.calls).toBe(0);
});

test("lazily creates the viewer's own Trash when none is resolved", async () => {
  const spy = ensureSpy({ id: "lazily-created-viewer-trash" });
  const nodesWithoutTrash = baseNodes.filter(
    (node) => node.id !== "viewer-trash",
  );

  expect(
    await resolveDeleteToTrashTarget({
      containerId: "viewer-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: nodesWithoutTrash,
      trashSystemSlot: VIEWER_TRASH_SLOT,
      ensureOwnTrashContainer: spy.ensure,
    }),
  ).toBe("lazily-created-viewer-trash");
  expect(spy.calls).toBe(1);
});

test("uses the logical current org when the source is missing and Trash slots collide", async () => {
  const spy = ensureSpy({ id: "should-not-be-used" });

  expect(
    await resolveDeleteToTrashTarget({
      containerId: "missing-source-container",
      currentOrganizationId: VIEWER_ORG,
      nodes: nodesWithCollidingCustomTrash,
      trashSystemSlot: VIEWER_TRASH_SLOT,
      ensureOwnTrashContainer: spy.ensure,
    }),
  ).toBe("viewer-trash");
  expect(spy.calls).toBe(0);
});

test("does not select another org's Trash when the source and own Trash are missing", async () => {
  const spy = ensureSpy(null);
  const nodesWithoutViewerTrash = nodesWithCollidingCustomTrash.filter(
    (node) => node.id !== "viewer-trash",
  );

  expect(
    await resolveDeleteToTrashTarget({
      containerId: "missing-source-container",
      currentOrganizationId: VIEWER_ORG,
      nodes: nodesWithoutViewerTrash,
      trashSystemSlot: VIEWER_TRASH_SLOT,
      ensureOwnTrashContainer: spy.ensure,
    }),
  ).toBeNull();
  expect(spy.calls).toBe(1);
});

test("never falls back to the viewer's Trash for a foreign-org container with no Trash", async () => {
  const spy = ensureSpy({ id: "must-not-be-used" });

  expect(
    await resolveDeleteToTrashTarget({
      containerId: "owner-folder",
      currentOrganizationId: VIEWER_ORG,
      nodes: baseNodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
      ensureOwnTrashContainer: spy.ensure,
    }),
  ).toBeNull();
  expect(spy.calls).toBe(0);
});

test("no-ops when the document already lives under Trash", async () => {
  const spy = ensureSpy({ id: "must-not-be-used" });

  expect(
    await resolveDeleteToTrashTarget({
      containerId: "viewer-trash",
      currentOrganizationId: VIEWER_ORG,
      nodes: baseNodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
      ensureOwnTrashContainer: spy.ensure,
    }),
  ).toBeNull();
  expect(spy.calls).toBe(0);
});
