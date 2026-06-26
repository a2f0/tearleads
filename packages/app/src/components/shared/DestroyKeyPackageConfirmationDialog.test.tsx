import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE,
  DestroyKeyPackageConfirmationDialog,
} from "./DestroyKeyPackageConfirmationDialog";

afterEach(() => cleanup());

function renderDialog(
  overrides: Partial<
    Parameters<typeof DestroyKeyPackageConfirmationDialog>[0]
  > = {},
) {
  let cancelCount = 0;
  let confirmCount = 0;
  const view = render(
    <DestroyKeyPackageConfirmationDialog
      isOpen
      onCancel={() => {
        cancelCount += 1;
      }}
      onConfirm={() => {
        confirmCount += 1;
      }}
      {...overrides}
    />,
  );

  return {
    getCancelCount: () => cancelCount,
    getConfirmCount: () => confirmCount,
    view,
  };
}

test("does not render when closed", () => {
  const view = render(
    <DestroyKeyPackageConfirmationDialog
      isOpen={false}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );

  expect(view.queryByRole("dialog")).toBeNull();
});

test("requires the confirmation phrase before destroying", () => {
  const { getConfirmCount, view } = renderDialog();

  expect(view.getByRole("dialog")).toBeTruthy();
  expect(view.getByText(/non-recoverable operation/u)).toBeTruthy();

  const destroyButton = view.getByRole("button", {
    name: "Destroy Key Package",
  }) as HTMLButtonElement;
  expect(destroyButton.disabled).toBe(true);

  fireEvent.change(view.getByLabelText(/Type confirm delete to continue/u), {
    target: { value: "delete" },
  });
  expect(destroyButton.disabled).toBe(true);

  fireEvent.change(view.getByLabelText(/Type confirm delete to continue/u), {
    target: { value: `${DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE} ` },
  });
  expect(destroyButton.disabled).toBe(false);

  fireEvent.change(view.getByLabelText(/Type confirm delete to continue/u), {
    target: { value: DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE },
  });
  expect(destroyButton.disabled).toBe(false);

  fireEvent.click(destroyButton);
  expect(getConfirmCount()).toBe(1);
});

test("cancel invokes onCancel without confirming", () => {
  const { getCancelCount, getConfirmCount, view } = renderDialog();

  fireEvent.click(view.getByRole("button", { name: "Cancel" }));

  expect(getCancelCount()).toBe(1);
  expect(getConfirmCount()).toBe(0);
});

test("resets confirmation text when hidden", () => {
  const { view } = renderDialog();
  const input = view.getByLabelText(
    /Type confirm delete to continue/u,
  ) as HTMLInputElement;

  fireEvent.change(input, {
    target: { value: DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE },
  });
  expect(input.value).toBe(DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE);

  view.rerender(
    <DestroyKeyPackageConfirmationDialog
      isOpen={false}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(view.queryByRole("dialog")).toBeNull();

  view.rerender(
    <DestroyKeyPackageConfirmationDialog
      isOpen
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );

  expect(
    (
      view.getByLabelText(
        /Type confirm delete to continue/u,
      ) as HTMLInputElement
    ).value,
  ).toBe("");
});
