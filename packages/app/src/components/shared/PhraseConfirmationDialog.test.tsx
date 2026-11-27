import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PhraseConfirmationDialog } from "./PhraseConfirmationDialog";

afterEach(() => cleanup());

test("escape cancels when idle, is ignored while busy, and restores opener focus", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  try {
    let cancelCount = 0;
    const view = render(
      <PhraseConfirmationDialog
        busy
        confirmLabel="Reset"
        isOpen
        onCancel={() => {
          cancelCount += 1;
        }}
        onConfirm={() => undefined}
        phrase="Reset device"
        title="Reset device"
        warning="This erases local data."
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelCount).toBe(0);

    view.rerender(
      <PhraseConfirmationDialog
        busy={false}
        confirmLabel="Reset"
        isOpen
        onCancel={() => {
          cancelCount += 1;
        }}
        onConfirm={() => undefined}
        phrase="Reset device"
        title="Reset device"
        warning="This erases local data."
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelCount).toBe(1);

    view.unmount();
    expect(document.activeElement).toBe(opener);
  } finally {
    opener.remove();
  }
});
