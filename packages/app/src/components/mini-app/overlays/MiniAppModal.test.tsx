import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
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
    "mini-app-modal-backdrop custom-backdrop",
  );
  expect(dialog.className).toBe("mini-app-modal-panel custom-panel");
  expect(form?.className).toBe("mini-app-modal-form custom-form");

  if (!form) throw new Error("modal form not found");
  fireEvent.submit(form);

  expect(submitted).toBe(true);
});
