import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  RUNTIME_RESTART_LABELS,
  RuntimeRestartNotice,
  RuntimeRestartNoticeView,
  type RuntimeRestartSource,
} from "./RuntimeRestartNotice";

afterEach(() => cleanup());

const IGNORE = () => {};

/** A runtime needing a restart, whose open documents hold `pending` edits. */
function restartSource(pending: () => boolean) {
  const steps: string[] = [];
  const source: RuntimeRestartSource = {
    getStatus: () => "restartRequired",
    hasPendingWrites: pending,
    prepare: () => {
      steps.push("prepare");
      return Promise.resolve();
    },
    reload: () => steps.push("reload"),
    subscribe: () => () => {},
  };
  return { source, steps };
}

// A healthy page shows nothing, and the shared runtime starts healthy.
test("a healthy runtime shows no notice", () => {
  const { container } = render(<RuntimeRestartNotice />);
  expect(container.innerHTML).toBe("");
  render(
    <RuntimeRestartNoticeView
      onDiscard={IGNORE}
      onKeep={IGNORE}
      onReload={IGNORE}
      status="healthy"
      step="offered"
    />,
  );
  expect(screen.queryByRole("status")).toBeNull();
});

// Only the user's press reloads: the notice waits for it.
test("a runtime that needs a restart offers Reload", () => {
  let reloads = 0;
  render(
    <RuntimeRestartNoticeView
      onDiscard={IGNORE}
      onKeep={IGNORE}
      onReload={() => {
        reloads += 1;
      }}
      status="restartRequired"
      step="offered"
    />,
  );

  expect(screen.getByRole("status").textContent).toContain(
    RUNTIME_RESTART_LABELS.message,
  );
  expect(reloads).toBe(0);
  fireEvent.click(
    screen.getByRole("button", { name: RUNTIME_RESTART_LABELS.reload }),
  );
  expect(reloads).toBe(1);
});

// While the SDK drains, the button waits; a page the user kept after the
// drain, as a browser does when its user cancels the unload prompt, offers
// Reload again.
test("the button waits for the drain and returns after it", () => {
  const { rerender } = render(
    <RuntimeRestartNoticeView
      onDiscard={IGNORE}
      onKeep={IGNORE}
      onReload={IGNORE}
      status="draining"
      step="offered"
    />,
  );
  const draining = screen.getByRole("button", {
    name: RUNTIME_RESTART_LABELS.reloading,
  });
  expect(draining.hasAttribute("disabled")).toBe(true);

  rerender(
    <RuntimeRestartNoticeView
      onDiscard={IGNORE}
      onKeep={IGNORE}
      onReload={IGNORE}
      status="ready"
      step="offered"
    />,
  );

  expect(
    screen
      .getByRole("button", { name: RUNTIME_RESTART_LABELS.reload })
      .hasAttribute("disabled"),
  ).toBe(false);
});

// Edits reach SQLite first, then the SDK drains its read windows, and only
// then does the page reload.
test("Reload waits for edits to be saved, then prepares and reloads", async () => {
  let pending = true;
  const { source, steps } = restartSource(() => pending);
  render(<RuntimeRestartNotice saveWaitMs={5_000} source={source} />);

  fireEvent.click(
    screen.getByRole("button", { name: RUNTIME_RESTART_LABELS.reload }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(steps).toEqual([]);
  pending = false;

  await waitFor(() => expect(steps).toEqual(["prepare", "reload"]));
});

// Native shells ignore the unload prompt, so edits still unsaved after the
// wait are the notice's to ask about: the user keeps them or reloads anyway.
test("edits still unsaved ask before a reload loses them", async () => {
  const { source, steps } = restartSource(() => true);
  render(<RuntimeRestartNotice saveWaitMs={20} source={source} />);
  const pressReload = () =>
    fireEvent.click(
      screen.getByRole("button", { name: RUNTIME_RESTART_LABELS.reload }),
    );

  pressReload();
  await screen.findByText(RUNTIME_RESTART_LABELS.unsaved);
  expect(steps).toEqual([]);
  fireEvent.click(
    screen.getByRole("button", { name: RUNTIME_RESTART_LABELS.keep }),
  );
  expect(steps).toEqual([]);

  pressReload();
  fireEvent.click(
    await screen.findByRole("button", { name: RUNTIME_RESTART_LABELS.discard }),
  );
  await waitFor(() => expect(steps).toEqual(["prepare", "reload"]));
});
