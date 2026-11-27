import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

test("escape ignores a running purge, closes once settled, and restores focus", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  try {
    let closeCount = 0;
    const baseRun: ExplorerPurgeRunState = {
      error: null,
      kind: "container",
      moveSettlement: null,
      progress: null,
      status: "running",
      title: "Deleting",
    };
    const view = render(
      <ExplorerPurgeProgressModal
        onCancel={() => undefined}
        onClose={() => {
          closeCount += 1;
        }}
        run={baseRun}
      />,
    );

    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Stop" }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeCount).toBe(0);

    view.rerender(
      <ExplorerPurgeProgressModal
        onCancel={() => undefined}
        onClose={() => {
          closeCount += 1;
        }}
        run={{ ...baseRun, status: "done" }}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeCount).toBe(1);

    view.rerender(
      <ExplorerPurgeProgressModal
        onCancel={() => undefined}
        onClose={() => undefined}
        run={null}
      />,
    );
    expect(document.activeElement).toBe(opener);
  } finally {
    opener.remove();
  }
});
