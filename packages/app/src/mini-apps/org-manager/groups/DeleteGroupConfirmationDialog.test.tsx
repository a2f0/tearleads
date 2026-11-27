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

test("escape cancels even when deletion is disabled and restores opener focus", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  try {
    let cancelCount = 0;
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
          cancelCount += 1;
        }}
        onConfirm={() => undefined}
      />,
    );

    expect(document.activeElement).toBe(
      view.getByRole("button", { name: ORG_MANAGER_LABELS.cancel }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelCount).toBe(1);

    view.rerender(
      <DeleteGroupConfirmationDialog
        disabled
        group={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(document.activeElement).toBe(opener);
  } finally {
    opener.remove();
  }
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
