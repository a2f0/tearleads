import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { IdentityManagerLogoutDialog } from "./IdentityManagerLogoutDialog";

afterEach(() => cleanup());

function renderDialog(
  overrides: Partial<Parameters<typeof IdentityManagerLogoutDialog>[0]> = {},
) {
  const confirmCalls: Array<{ keepLocalData: boolean }> = [];
  let cancelCount = 0;
  const view = render(
    <IdentityManagerLogoutDialog
      busy={false}
      isOpen
      onCancel={() => {
        cancelCount += 1;
      }}
      onConfirm={(input) => confirmCalls.push(input)}
      {...overrides}
    />,
  );
  return { confirmCalls, getCancelCount: () => cancelCount, view };
}

test("does not render when closed", () => {
  const view = render(
    <IdentityManagerLogoutDialog
      busy={false}
      isOpen={false}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(view.queryByRole("dialog")).toBeNull();
});

test("keeps local data by default and confirms with keepLocalData true", () => {
  const { confirmCalls, view } = renderDialog();

  const checkbox = view.getByRole("checkbox") as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  // The destructive warning is hidden while data is kept.
  expect(view.queryByText(/permanently destroyed/u)).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Log Out" }));
  expect(confirmCalls).toEqual([{ keepLocalData: true }]);
});

test("confirms with keepLocalData false once the checkbox is cleared", () => {
  const { confirmCalls, view } = renderDialog();

  const checkbox = view.getByRole("checkbox") as HTMLInputElement;
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(false);
  // Clearing the checkbox surfaces the destructive warning.
  expect(view.getByText(/permanently destroyed/u)).toBeDefined();

  fireEvent.click(view.getByRole("button", { name: "Log Out" }));
  expect(confirmCalls).toEqual([{ keepLocalData: false }]);
});

test("cancel invokes onCancel without confirming", () => {
  const { confirmCalls, getCancelCount, view } = renderDialog();

  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(getCancelCount()).toBe(1);
  expect(confirmCalls).toEqual([]);
});

test("does not confirm while busy", () => {
  const { confirmCalls, view } = renderDialog({ busy: true });

  const form = view.getByRole("dialog").querySelector("form");
  if (!form) {
    throw new Error("Expected the logout dialog form.");
  }
  fireEvent.submit(form);
  expect(confirmCalls).toEqual([]);
});
