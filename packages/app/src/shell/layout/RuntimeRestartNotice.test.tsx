import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  RUNTIME_RESTART_LABELS,
  RuntimeRestartNotice,
  RuntimeRestartNoticeView,
} from "./RuntimeRestartNotice";

afterEach(() => cleanup());

// A healthy page shows nothing, and the shared runtime starts healthy.
test("a healthy runtime shows no notice", () => {
  const { container } = render(<RuntimeRestartNotice />);
  expect(container.innerHTML).toBe("");
  render(<RuntimeRestartNoticeView onReload={() => {}} status="healthy" />);
  expect(screen.queryByRole("status")).toBeNull();
});

// Only the user's press reloads: the notice waits for it.
test("a runtime that needs a restart offers Reload", () => {
  let reloads = 0;
  render(
    <RuntimeRestartNoticeView
      onReload={() => {
        reloads += 1;
      }}
      status="restartRequired"
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
// drain, by cancelling the unload prompt, offers Reload again.
test("the button waits for the drain and returns after it", () => {
  const { rerender } = render(
    <RuntimeRestartNoticeView onReload={() => {}} status="draining" />,
  );
  const draining = screen.getByRole("button", {
    name: RUNTIME_RESTART_LABELS.reloading,
  });
  expect(draining.hasAttribute("disabled")).toBe(true);

  rerender(<RuntimeRestartNoticeView onReload={() => {}} status="ready" />);

  expect(
    screen
      .getByRole("button", { name: RUNTIME_RESTART_LABELS.reload })
      .hasAttribute("disabled"),
  ).toBe(false);
});

// The page reloads only after the SDK has drained its read windows.
test("Reload prepares the restart before reloading", async () => {
  const steps: string[] = [];
  const prepared = Promise.withResolvers<void>();
  render(
    <RuntimeRestartNotice
      source={{
        getStatus: () => "restartRequired",
        prepare: () => {
          steps.push("prepare");
          return prepared.promise;
        },
        reload: () => steps.push("reload"),
        subscribe: () => () => {},
      }}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: RUNTIME_RESTART_LABELS.reload }),
  );
  expect(steps).toEqual(["prepare"]);
  prepared.resolve();
  await prepared.promise;
  await Promise.resolve();

  expect(steps).toEqual(["prepare", "reload"]);
});
