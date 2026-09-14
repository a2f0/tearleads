import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { TrashUnavailableError } from "../../../stores/systemContainerTrash";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import {
  resolveExplorerTrashDestination,
  useExplorerContainerTrashActions,
} from "./useExplorerContainerTrashActions";

afterEach(() => cleanup());

const VIEWER_ORG = "viewer-org";
const OWNER_ORG = "owner-org";
const VIEWER_TRASH_SLOT = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

function node(
  id: string,
  organizationId: string,
  parentId: string | null,
  systemSlot?: string,
): ContainerNode {
  return {
    id,
    kind: "container",
    name: id,
    organizationId,
    parentId,
    syncState: syncedContainerDocumentObjectSyncState,
    ...(systemSlot ? { systemSlot } : {}),
  };
}

// The viewer's own org (root + slot-verified Trash) next to a foreign shared
// root owned by another identity, whose Trash slot the viewer cannot derive.
const nodes: ReadonlyArray<ContainerNode> = [
  node("viewer-root", VIEWER_ORG, null),
  node("viewer-trash", VIEWER_ORG, "viewer-root", VIEWER_TRASH_SLOT),
  node("owner-root", OWNER_ORG, null),
  node("owner-folder", OWNER_ORG, "owner-root"),
  node("owner-subfolder", OWNER_ORG, "owner-folder"),
];

function createHarness(input?: { nodes?: ReadonlyArray<ContainerNode> }) {
  const logged: Array<{ message: string | Error; cause: unknown }> = [];
  const moved: string[] = [];
  const explorer = {
    emptyTrash: async () => true,
    ensureTrashContainer: async () => null,
    moveContainer: async (containerId: string) => {
      moved.push(containerId);
      return null;
    },
    nodes: input?.nodes ?? nodes,
    purgeContainer: async () => true,
    trashSystemSlot: VIEWER_TRASH_SLOT,
  } as unknown as ExplorerModelExplorer;
  const appData = {
    auth: { organizationId: VIEWER_ORG },
    state: { online: true },
    util: {
      logError: (message: string | Error, cause?: unknown) => {
        logged.push({ cause, message });
      },
    },
  } as unknown as RuntimeSnapshot;
  return { appData, explorer, logged, moved };
}

test("moving a folder under an unverifiable foreign Trash reports Trash unavailable", async () => {
  const { appData, explorer, logged, moved } = createHarness();
  const { result } = renderHook(() =>
    useExplorerContainerTrashActions({
      appData,
      explorer,
      onSettled: () => undefined,
      selectExplorerItem: () => undefined,
    }),
  );

  await act(async () => {
    expect(await result.current.moveContainerToTrash("owner-subfolder")).toBe(
      null,
    );
  });

  // The folder stays put and the typed outcome reaches the user through the
  // handler's error path (the same path the Notes trash hook uses), instead of
  // the move silently doing nothing.
  expect(moved).toEqual([]);
  expect(logged).toEqual([
    {
      cause: expect.objectContaining({
        name: "TrashUnavailableError",
        reason: "foreign-trash-unverified",
        message:
          "This organization's Trash cannot be verified from this device.",
      }),
      message: "Failed to move explorer container to trash",
    },
  ]);
  expect(logged[0]?.cause).toBeInstanceOf(TrashUnavailableError);
});

test("the shared destination resolver surfaces an own-org Trash awaiting sync", async () => {
  // A fresh device: the viewer's Trash has not arrived yet and the lazy create
  // (stubbed to null) cannot provision it either.
  const { explorer } = createHarness({
    nodes: nodes.filter((entry) => entry.id !== "viewer-trash"),
  });
  await expect(
    resolveExplorerTrashDestination({
      containerId: "viewer-root",
      currentOrganizationId: VIEWER_ORG,
      explorer,
    }),
  ).rejects.toMatchObject({
    name: "TrashUnavailableError",
    reason: "awaiting-sync",
  });
});
