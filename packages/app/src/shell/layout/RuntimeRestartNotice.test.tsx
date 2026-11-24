import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { registerPageDocumentWrites } from "../../providers/db/pageDocumentWrites";
import {
  RUNTIME_RESTART_LABELS,
  RuntimeRestartNotice,
  RuntimeRestartNoticeView,
  type RuntimeRestartSource,
  SDK_RUNTIME_RESTART,
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

// The app's own source asks every runtime mounted in the page.
test("the app's source asks the page's runtimes for unsaved edits", () => {
  expect(SDK_RUNTIME_RESTART.hasPendingWrites()).toBe(false);
  const unregister = registerPageDocumentWrites(() => true);
  expect(SDK_RUNTIME_RESTART.hasPendingWrites()).toBe(true);
  unregister();
  expect(SDK_RUNTIME_RESTART.hasPendingWrites()).toBe(false);
});

// A run the notice has left acts no further: a source replaced mid-press
// neither asks about edits early nor reloads before its own drain, and the
// page reloads once.
test("a source replaced mid-press neither asks early nor reloads early", async () => {
  let pending = true;
  let reloads = 0;
  const makeSource = (prepared: Promise<void>): RuntimeRestartSource => ({
    getStatus: () => "restartRequired",
    hasPendingWrites: () => pending,
    prepare: () => prepared,
    reload: () => {
      reloads += 1;
    },
    subscribe: () => () => {},
  });
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const notice = (prepared: Promise<void>) => (
    <RuntimeRestartNotice saveWaitMs={5_000} source={makeSource(prepared)} />
  );
  const { rerender } = render(notice(first.promise));
  fireEvent.click(
    screen.getByRole("button", { name: RUNTIME_RESTART_LABELS.reload }),
  );

  rerender(notice(first.promise));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(screen.queryByText(RUNTIME_RESTART_LABELS.unsaved)).toBeNull();
  pending = false;
  await new Promise((resolve) => setTimeout(resolve, 150));
  rerender(notice(second.promise));
  first.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(reloads).toBe(0);

  second.resolve();
  await waitFor(() => expect(reloads).toBe(1));
  rerender(notice(second.promise));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(reloads).toBe(1);
});

// Native shells ignore the unload prompt, so edits typed while the SDK
// drained ask too, unless the user already chose to lose them.
test("edits made while draining ask before the reload", async () => {
  let pending = false;
  const steps: string[] = [];
  const source: RuntimeRestartSource = {
    getStatus: () => "restartRequired",
    hasPendingWrites: () => pending,
    prepare: () => {
      steps.push("prepare");
      pending = true;
      return Promise.resolve();
    },
    reload: () => steps.push("reload"),
    subscribe: () => () => {},
  };
  render(<RuntimeRestartNotice saveWaitMs={5_000} source={source} />);

  fireEvent.click(
    screen.getByRole("button", { name: RUNTIME_RESTART_LABELS.reload }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: RUNTIME_RESTART_LABELS.discard }),
  );

  await waitFor(() => expect(steps).toEqual(["prepare", "prepare", "reload"]));
});

// `location.reload()` returns before the page unloads, so the notice waits;
// it offers Reload again only once the SDK asks again, after its hold, in a
// page that was kept.
test("a reload offers itself again only when the SDK asks again", async () => {
  let health: "ready" | "restartRequired" = "restartRequired";
  const listeners = new Set<() => void>();
  let reloads = 0;
  const source: RuntimeRestartSource = {
    getStatus: () => health,
    hasPendingWrites: () => false,
    prepare: () => {
      health = "ready";
      for (const listener of listeners) listener();
      return Promise.resolve();
    },
    reload: () => {
      reloads += 1;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const { rerender } = render(
    <RuntimeRestartNotice saveWaitMs={5_000} source={source} />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: RUNTIME_RESTART_LABELS.reload }),
  );
  await waitFor(() => expect(reloads).toBe(1));
  // A source replaced while the page unloads does not reload it again.
  rerender(<RuntimeRestartNotice saveWaitMs={5_000} source={{ ...source }} />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(reloads).toBe(1);
  const waiting = screen.getByRole("button", {
    name: RUNTIME_RESTART_LABELS.reloading,
  });
  expect(waiting.hasAttribute("disabled")).toBe(true);

  act(() => {
    health = "restartRequired";
    for (const listener of listeners) listener();
  });

  expect(
    (
      await screen.findByRole("button", { name: RUNTIME_RESTART_LABELS.reload })
    ).hasAttribute("disabled"),
  ).toBe(false);
});
