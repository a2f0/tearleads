import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { PhraseConfirmationDialog } from "./PhraseConfirmationDialog";

afterEach(() => cleanup());

test("focuses input under StrictMode, guards busy Escape, and restores opener focus", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  try {
    let cancelCount = 0;
    const view = render(
      <StrictMode>
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
        />
      </StrictMode>,
    );

    expect(document.activeElement).toBe(view.getByRole("textbox"));

    view.rerender(
      <StrictMode>
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
        />
      </StrictMode>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelCount).toBe(0);

    view.rerender(
      <StrictMode>
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
        />
      </StrictMode>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelCount).toBe(1);

    view.unmount();
    expect(document.activeElement).toBe(opener);
  } finally {
    opener.remove();
  }
});
