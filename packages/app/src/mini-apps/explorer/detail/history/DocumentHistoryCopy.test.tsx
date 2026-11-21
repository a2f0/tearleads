import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { EXPLORER_LABELS } from "../../labels";
import {
  COPY,
  confirmCopy,
  copyButton,
  DOCUMENT,
  mount,
  VIEW,
  versionCopy,
} from "./DocumentHistoryCopy.testFixtures";

afterEach(cleanup);

test("a confirmed copy saves the version on screen beside its document", async () => {
  const capability = versionCopy();
  const view = mount(capability);

  await confirmCopy(view);
  expect(capability.saves).toHaveLength(1);
  expect(capability.saves[0]?.document).toBe(DOCUMENT);
  expect(capability.saves[0]?.content).toBe(VIEW);
  expect(view.queryByRole("dialog")).toBeNull();
  // The folder is asked about the version's kind, not the document's.
  expect(capability.asked.at(-1)).toEqual({
    document: DOCUMENT,
    documentKind: "note",
  });

  await act(async () => capability.saves[0]?.settle(COPY));
  expect(view.getByText(EXPLORER_LABELS.documentHistoryCopySaved)).toBeTruthy();
});

test("a saved copy can be opened", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);
  await act(async () => capability.saves[0]?.settle(COPY));

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyOpenAction,
    }),
  );

  expect(capability.opened).toEqual([COPY]);
});

test("asking to copy tells the host to hold the timeline before confirming", async () => {
  const capability = versionCopy();
  const order: string[] = [];
  const view = mount(capability, { onRequested: () => order.push("held") });

  fireEvent.click(copyButton(view));
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });

  // During playback the next tick would otherwise move to another stop and
  // dismiss this confirmation.
  expect(order).toEqual(["held"]);
  expect(capability.saves).toHaveLength(0);
});

test("nothing is created until the copy is confirmed, and cancelling abandons it", async () => {
  const capability = versionCopy();
  const view = mount(capability);

  fireEvent.click(copyButton(view));
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyCancel,
    }),
  );

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(capability.saves).toHaveLength(0);
});

test("the confirmation says what is and is not copied", async () => {
  const capability = versionCopy();
  const view = mount(capability);

  fireEvent.click(copyButton(view));
  const dialog = await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });

  expect(dialog.textContent).toContain("Jan 1, 2030, 12:00:00 PM");
  expect(dialog.textContent).toContain("Attachments are not copied");
});

test("the confirmation takes focus, closes on Escape, and gives focus back", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  const trigger = copyButton(view);
  trigger.focus();
  fireEvent.click(trigger);

  const cancel = await view.findByRole("button", {
    name: EXPLORER_LABELS.documentHistoryCopyCancel,
  });
  // Focus starts on the safe choice, not on Save copy.
  expect(document.activeElement).toBe(cancel);

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(capability.saves).toHaveLength(0);
});

test("the copy is not offered where the folder does not take it", () => {
  const capability = versionCopy();
  capability.state.offered = false;
  const view = mount(capability);

  expect(view.queryByRole("button")).toBeNull();
});

test("confirming twice creates one document", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  fireEvent.click(copyButton(view));
  const form = (
    await view.findByRole("dialog", {
      name: EXPLORER_LABELS.documentHistoryCopyTitle,
    })
  ).querySelector("form");
  if (!form) throw new Error("the confirmation has no form");

  // Two submits before React renders the dialog away.
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });

  expect(capability.saves).toHaveLength(1);
});

test("a copy in flight cannot be started again", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  fireEvent.click(copyButton(view));

  expect(view.queryByRole("dialog")).toBeNull();
  expect(capability.saves).toHaveLength(1);
});

test("a copy that was not created is reported, and moving on clears it", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  await act(async () => capability.saves[0]?.settle(null));
  expect(
    view.getByText(EXPLORER_LABELS.documentHistoryCopyRefused),
  ).toBeTruthy();

  view.update({ index: 1 });
  await waitFor(() =>
    expect(
      view.queryByText(EXPLORER_LABELS.documentHistoryCopyRefused),
    ).toBeNull(),
  );
});

test("a copy that failed is reported as not created", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  await act(async () => capability.saves[0]?.fail(new Error("no database")));

  expect(
    view.getByText(EXPLORER_LABELS.documentHistoryCopyRefused),
  ).toBeTruthy();
});

test("a confirmation is refused in sight when the copy stops being offered", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  fireEvent.click(copyButton(view));
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });

  // The folder is trashed while the confirmation is open.
  capability.state.offered = false;
  view.update();
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(
    view.getByText(EXPLORER_LABELS.documentHistoryCopyRefused),
  ).toBeTruthy();
  expect(capability.saves).toHaveLength(0);

  // The offer returning does not bring the confirmation back unasked.
  capability.state.offered = true;
  view.update();
  expect(copyButton(view)).toBeTruthy();
  expect(view.queryByRole("dialog")).toBeNull();
  expect(capability.saves).toHaveLength(0);
});

test("a copy that throws before it starts is reported as not created", async () => {
  const capability = versionCopy();
  capability.copy.save = () => {
    throw new Error("no runtime");
  };
  const view = mount(capability);
  await confirmCopy(view);

  await waitFor(() =>
    expect(
      view.getByText(EXPLORER_LABELS.documentHistoryCopyRefused),
    ).toBeTruthy(),
  );
  // Nothing is left latched: the copy can be asked for again.
  fireEvent.click(copyButton(view));
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });
});
