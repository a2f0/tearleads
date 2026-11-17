import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import {
  ContainerPathTooDeepError,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { TrashUnavailableError } from "../../../stores/systemContainerTrash";
import type { ExplorerRoute } from "../routes";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import {
  resolveExplorerTrashDestination,
  useExplorerContainerTrashActions,
  useExplorerSelectionFollowUp,
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
      beginSelectionFollowUp: () => () => undefined,
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

test("a folder too deep to move into Trash tells the user to Delete Forever", async () => {
  const { appData, explorer } = createHarness({
    nodes: [...nodes, node("viewer-folder", VIEWER_ORG, "viewer-root")],
  });
  explorer.moveContainer = async () => {
    throw new ContainerPathTooDeepError();
  };
  const reported: (string | null)[] = [];
  const { result } = renderHook(() =>
    useExplorerContainerTrashActions({
      appData,
      explorer,
      onSettled: () => undefined,
      reportBackgroundError: (message) => {
        reported.push(message);
      },
      beginSelectionFollowUp: () => () => undefined,
    }),
  );

  await act(async () => {
    expect(await result.current.moveContainerToTrash("viewer-folder")).toBe(
      null,
    );
  });

  expect(reported).toEqual([
    "This folder is nested too deeply to move to Trash. Use Delete Forever instead.",
  ]);
});

// The trash actions composed with the real selection follow-up, the way the
// panel wires them, around a move that settles only when the test says so.
function renderPendingFolderMove() {
  const { appData, explorer } = createHarness({
    nodes: [...nodes, node("viewer-folder", VIEWER_ORG, "viewer-root")],
  });
  let settleMove: (moved: ContainerNode | null) => void = () => undefined;
  const pendingMove = new Promise<ContainerNode | null>((resolve) => {
    settleMove = resolve;
  });
  explorer.moveContainer = () => pendingMove;
  const selected: Array<string | null> = [];
  const view = renderHook(
    (props: { selectedId: string }) =>
      useExplorerContainerTrashActions({
        appData,
        beginSelectionFollowUp: useExplorerSelectionFollowUp({
          route: { view: "selection" },
          selectedId: props.selectedId,
          selectExplorerItem: (id) => {
            selected.push(id);
          },
        }),
        explorer,
        onSettled: () => undefined,
      }),
    { initialProps: { selectedId: "viewer-folder" } },
  );
  const move = view.result.current.moveContainerToTrash("viewer-folder");
  const settle = () =>
    act(async () => {
      settleMove(node("viewer-folder", VIEWER_ORG, "viewer-trash"));
      await move;
    });
  return { selected, settle, view };
}

test("a folder moved to Trash re-selects its parent once the move settles", async () => {
  const { selected, settle } = renderPendingFolderMove();

  await settle();

  expect(selected).toEqual(["viewer-root"]);
});

test("a folder move that settles after the user navigated keeps their selection", async () => {
  const { selected, settle, view } = renderPendingFolderMove();

  // The user opens the Trash while the move is still in flight.
  view.rerender({ selectedId: "viewer-trash" });
  await settle();

  expect(selected).toEqual([]);
});

interface FollowUpPosition {
  route: ExplorerRoute;
  selectedId: string | null;
}

// A note opened from the Notes container.
function openNote(containerId = "notes"): FollowUpPosition {
  return {
    route: { containerId, localId: "note", view: "document-selection" },
    selectedId: "note",
  };
}

function renderFollowUp() {
  const selected: Array<string | null> = [];
  const view = renderHook(
    (props: FollowUpPosition) =>
      useExplorerSelectionFollowUp({
        ...props,
        selectExplorerItem: (id) => {
          selected.push(id);
        },
      }),
    { initialProps: openNote() },
  );
  return { selected, view };
}

test("a follow-up selects while the Explorer has not moved", () => {
  const { selected, view } = renderFollowUp();
  const followUp = view.result.current();

  // An equal route parsed again is not a move.
  view.rerender(openNote());
  followUp("source");

  expect(selected).toEqual(["source"]);
});

test("a follow-up yields to another detail view opened after it began", () => {
  const { selected, view } = renderFollowUp();
  const followUp = view.result.current();

  view.rerender({ route: { view: "sync-lanes" }, selectedId: "note" });
  followUp("source");

  expect(selected).toEqual([]);
});

test("a follow-up yields to the same linked document opened elsewhere", () => {
  const { selected, view } = renderFollowUp();
  const followUp = view.result.current();

  // A linked document keeps its local id in every container it is linked to.
  view.rerender(openNote("shared"));
  followUp("source");

  expect(selected).toEqual([]);
});

test("a follow-up begun after a move compares against the new position", () => {
  const { selected, view } = renderFollowUp();
  view.rerender({ route: { view: "selection" }, selectedId: "trash" });

  view.result.current()("source");

  expect(selected).toEqual(["source"]);
});

test("a folder move that settles after the Explorer unmounted selects nothing", async () => {
  const { selected, settle, view } = renderPendingFolderMove();

  // The user leaves the Explorer (in the routed shell, selecting would
  // navigate back to it) while the move is still in flight.
  view.unmount();
  await settle();

  expect(selected).toEqual([]);
});
