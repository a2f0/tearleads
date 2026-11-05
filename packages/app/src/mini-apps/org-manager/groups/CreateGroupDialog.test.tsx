import { afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { ORG_MANAGER_BUSY_LABELS } from "../grants/busyLabels";
import { ORG_MANAGER_LABELS } from "../labels";
import { CreateGroupDialog } from "./CreateGroupDialog";

afterEach(cleanup);

function renderDialog(mutating: boolean) {
  return render(
    <CreateGroupDialog
      canCreateGroup
      closeCreateGroupDialog={() => undefined}
      createGroup={() => undefined}
      error={null}
      groupNameDraft="Operators"
      isOpen
      mutating={mutating}
      setGroupNameDraft={() => undefined}
    />,
  );
}

test("create group dialog covers itself with one busy overlay while creating", () => {
  const view = renderDialog(true);
  const dialog = view.getByRole("dialog", {
    name: ORG_MANAGER_LABELS.newGroupAction,
  });

  // Creating cannot be cancelled, so the whole panel shows progress instead
  // of a spinner inside the Create button.
  const status = within(dialog).getByRole("status");
  expect(status.className).toBe("mini-app-modal-busy");
  expect(status.textContent).toContain(ORG_MANAGER_BUSY_LABELS.creatingGroup);
  expect(dialog.querySelector(".mini-app-button-spinner")).toBeNull();
});

test("create group dialog shows no overlay while idle", () => {
  const view = renderDialog(false);
  expect(view.queryByRole("status")).toBeNull();
});
