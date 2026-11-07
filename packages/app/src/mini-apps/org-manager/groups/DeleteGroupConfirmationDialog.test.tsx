import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { DeleteGroupConfirmationDialog } from "./DeleteGroupConfirmationDialog";

afterEach(cleanup);

test("disabled deletion blocks form submission but still allows cancellation", () => {
  let confirmed = false;
  let cancelled = false;
  const view = render(
    <DeleteGroupConfirmationDialog
      disabled
      group={{
        createdAt: "2026-05-20T12:00:00.000Z",
        currentState: null,
        groupId: "group-1",
        isBuiltin: false,
        name: "Operators",
        nameUnreadable: false,
        organizationId: "organization-1",
      }}
      onCancel={() => {
        cancelled = true;
      }}
      onConfirm={() => {
        confirmed = true;
      }}
    />,
  );
  const submit = view.getByRole("button", {
    name: ORG_MANAGER_LABELS.deleteGroupAction,
  }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.submit(submit.form as HTMLFormElement);
  expect(confirmed).toBe(false);
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.cancel }),
  );
  expect(cancelled).toBe(true);
});

test("identifies unreadable groups with the same fallback as the group list", () => {
  const view = render(
    <DeleteGroupConfirmationDialog
      disabled={false}
      group={{
        createdAt: "2026-05-20T12:00:00.000Z",
        currentState: null,
        groupId: "unreadable-group",
        isBuiltin: false,
        name: "",
        nameUnreadable: true,
        organizationId: "organization-1",
      }}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(
    view.getByText((text) =>
      text.includes(ORG_MANAGER_LABELS.unreadableGroupName),
    ),
  ).toBeTruthy();
});
