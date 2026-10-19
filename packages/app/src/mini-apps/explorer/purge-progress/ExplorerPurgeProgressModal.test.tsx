import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { ExplorerPurgeProgressModal } from "./ExplorerPurgeProgressModal";
import type { ExplorerPurgeRunState } from "./useExplorerPurgeRun";

afterEach(() => cleanup());

function renderRun(run: Partial<ExplorerPurgeRunState>) {
  render(
    <ExplorerPurgeProgressModal
      onCancel={() => {}}
      onClose={() => {}}
      run={{
        error: null,
        kind: "container",
        moveSettlement: null,
        progress: null,
        status: "running",
        title: "Deleting",
        ...run,
      }}
    />,
  );
}

test("a purge waiting on a queued move says it is finishing the move", () => {
  renderRun({ moveSettlement: "waiting" });
  expect(screen.getByText("Finishing move to Trash…")).toBeTruthy();
});

test("a purge stopped before any progress deleted nothing", () => {
  renderRun({ moveSettlement: "waiting", status: "cancelled" });
  expect(screen.getByText("Stopped. Nothing was deleted.")).toBeTruthy();
});

test("a purge stopped after it began may have deleted items", () => {
  // A remote delete can land even though its item then failed.
  renderRun({
    progress: { completedCount: 0, failedCount: 0, totalCount: 2 },
    status: "cancelled",
  });
  expect(
    screen.getByText("Stopped. Some items were permanently deleted."),
  ).toBeTruthy();
});
