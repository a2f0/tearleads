import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { EXPLORER_LABELS } from "../../labels";
import {
  COPY,
  confirmCopy,
  copyButton,
  mount,
  versionCopy,
} from "./DocumentHistoryCopy.testFixtures";

afterEach(cleanup);

test("a copy in flight reports on the stop selected when it finishes", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  // The user steps on while the copy is being created: the new stop replays,
  // so there is no version on screen to copy.
  view.update({ index: 1, replaying: true });
  expect(copyButton(view).hasAttribute("disabled")).toBe(true);
  await act(async () => capability.saves[0]?.settle(COPY));

  expect(view.getByText(EXPLORER_LABELS.documentHistoryCopySaved)).toBeTruthy();
  // It stays once that stop is on screen, and can be opened.
  view.update({ index: 1 });
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyOpenAction,
    }),
  );
  expect(capability.opened).toEqual([COPY]);
});

test("a copy in flight still reports after History reloads", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  // The timeline unmounts while History reloads, and the copy finishes.
  view.update({ timeline: false });
  await act(async () => capability.saves[0]?.settle(COPY));
  // History reopens on its newest stop, not the one that was copied.
  view.update({ index: 5 });

  await view.findByText(EXPLORER_LABELS.documentHistoryCopySaved);
  // It is that stop's notice from then on, and goes with the next stop.
  view.update({ index: 4 });
  await waitFor(() =>
    expect(
      view.queryByText(EXPLORER_LABELS.documentHistoryCopySaved),
    ).toBeNull(),
  );
});

test("a confirmation left open across a reload is dropped, not refused", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  fireEvent.click(copyButton(view));
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });

  // A restore finishes underneath and History reloads onto its new stop,
  // which is still replaying when the timeline comes back.
  view.update({ timeline: false });
  view.update({ index: 5, replaying: true });
  view.update({ index: 5 });

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  // Nothing was refused: the folder still takes the copy.
  expect(
    view.queryByText(EXPLORER_LABELS.documentHistoryCopyRefused),
  ).toBeNull();
  expect(copyButton(view)).toBeTruthy();
  expect(capability.saves).toHaveLength(0);
});

test("a stop that is only replaying withdraws nothing", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  fireEvent.click(copyButton(view));
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });

  // The same stop replays again; its version is briefly not on screen.
  view.update({ replaying: true });
  view.update();

  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });
  expect(
    view.queryByText(EXPLORER_LABELS.documentHistoryCopyRefused),
  ).toBeNull();
});

test("a saved copy is forgotten when the database or account changes", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);
  await act(async () => capability.saves[0]?.settle(COPY));
  expect(view.getByText(EXPLORER_LABELS.documentHistoryCopySaved)).toBeTruthy();

  view.update({ newScope: true });

  // The copy is the other scope's: nothing here offers to open it.
  await waitFor(() =>
    expect(
      view.queryByText(EXPLORER_LABELS.documentHistoryCopySaved),
    ).toBeNull(),
  );
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyOpenAction,
    }),
  ).toBeNull();
});

test("a copy finishing after the database or account changed reports nothing", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  view.update({ newScope: true });
  await act(async () => capability.saves[0]?.settle(COPY));

  expect(view.queryByText(EXPLORER_LABELS.documentHistoryCopySaved)).toBeNull();
  // The new scope can ask for its own copy at once.
  await confirmCopy(view);
  expect(capability.saves).toHaveLength(2);
});

test("a saved copy stays reachable when the folder stops taking documents", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  // The folder is trashed while the copy is being created.
  capability.state.offered = false;
  view.update();
  await act(async () => capability.saves[0]?.settle(COPY));

  expect(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyOpenAction,
    }),
  ).toBeTruthy();
  // No further copy is offered there.
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyAction,
    }),
  ).toBeNull();
});

test("a copy finishing after the control is gone reports nothing", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  view.unmount();

  // Settling must not throw or update an unmounted control.
  await act(async () => capability.saves[0]?.settle(COPY));
  expect(capability.opened).toHaveLength(0);
});
