import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import {
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalBusyOverlay,
  MiniAppModalForm,
  MiniAppModalPanel,
  useModalEscapeAndFocusRestore,
} from "../MiniAppLayout";

afterEach(() => cleanup());

test("mini app modal primitives preserve classes and form behavior", () => {
  let submitted = false;
  const view = render(
    <MiniAppModalBackdrop className="custom-backdrop" role="presentation">
      <MiniAppModalPanel
        aria-label="Rename container"
        className="custom-panel"
        role="dialog"
      >
        <MiniAppModalForm
          className="custom-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitted = true;
          }}
        >
          <h2>Rename</h2>
          <button type="submit">Save</button>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>,
  );

  const dialog = view.getByRole("dialog", { name: "Rename container" });
  const form = dialog.querySelector("form");

  expect(view.container.firstElementChild?.className).toBe(
    "mini-app-modal-backdrop mini-app-modal-backdrop--takeover custom-backdrop",
  );
  expect(dialog.className).toBe(
    "mini-app-modal-panel mini-app-modal-panel--takeover custom-panel",
  );
  expect(form?.className).toBe("mini-app-modal-form custom-form");

  if (!form) throw new Error("modal form not found");
  fireEvent.submit(form);

  expect(submitted).toBe(true);
});

test("a modal backdrop names its layer, and a viewer can float instead", () => {
  const view = render(
    <>
      <MiniAppModalBackdrop data-testid="section" />
      <MiniAppModalBackdrop data-testid="raised" layer="raised" />
      <MiniAppModalBackdrop data-testid="viewport" layer="viewport" />
      <MiniAppModalBackdrop data-testid="floating" floating>
        <MiniAppModalPanel data-testid="floating-panel" floating />
      </MiniAppModalBackdrop>
    </>,
  );

  expect(view.getByTestId("section").className).toBe(
    "mini-app-modal-backdrop mini-app-modal-backdrop--takeover",
  );
  expect(view.getByTestId("raised").className).toBe(
    "mini-app-modal-backdrop mini-app-modal-backdrop--takeover mini-app-modal-backdrop--raised",
  );
  expect(view.getByTestId("viewport").className).toBe(
    "mini-app-modal-backdrop mini-app-modal-backdrop--takeover mini-app-modal-backdrop--viewport",
  );
  expect(view.getByTestId("floating").className).toBe(
    "mini-app-modal-backdrop mini-app-modal-backdrop--floating",
  );
  expect(view.getByTestId("floating-panel").className).toBe(
    "mini-app-modal-panel mini-app-modal-panel--floating",
  );
});

test("busy overlay resets takeover modal panel scrollTop on mount", () => {
  function BusyPanelHarness({ busy }: { busy: boolean }) {
    return (
      <MiniAppModalBackdrop role="presentation">
        <MiniAppModalPanel data-testid="panel" role="dialog">
          <div>Form body</div>
          {busy && <MiniAppModalBusyOverlay label="Saving..." />}
        </MiniAppModalPanel>
      </MiniAppModalBackdrop>
    );
  }

  const view = render(<BusyPanelHarness busy={false} />);
  const panel = view.getByTestId("panel");
  panel.scrollTop = 180;
  expect(panel.scrollTop).toBe(180);

  view.rerender(<BusyPanelHarness busy />);
  expect(panel.scrollTop).toBe(0);
});

test("useModalEscapeAndFocusRestore restores opener focus even with autoFocus inside dialog", () => {
  function AutoFocusDialog({ onClose }: { onClose: () => void }) {
    useModalEscapeAndFocusRestore(onClose);
    return (
      <div role="dialog">
        <MiniAppInput aria-label="Confirm phrase" autoFocus />
      </div>
    );
  }

  function Harness({ keepOpener = true }: { keepOpener?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <div>
        {keepOpener && (
          <button onClick={() => setOpen(true)} type="button">
            Open dialog
          </button>
        )}
        {open && <AutoFocusDialog onClose={() => setOpen(false)} />}
      </div>
    );
  }

  const view = render(<Harness />);
  const opener = view.getByRole("button", { name: "Open dialog" });
  act(() => opener.focus());
  fireEvent.click(opener);

  const input = view.getByLabelText("Confirm phrase");
  expect(document.activeElement).toBe(input);

  fireEvent.keyDown(document, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);

  // If the triggering button was removed before closing, skip restoring to it.
  fireEvent.click(opener);
  view.rerender(<Harness keepOpener={false} />);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).not.toBe(opener);
});
