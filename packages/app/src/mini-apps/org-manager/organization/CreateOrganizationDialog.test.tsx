import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { CreateOrganizationDialog } from "./CreateOrganizationDialog";

afterEach(() => cleanup());

function DialogHarness({
  close,
  create,
}: {
  close: () => void;
  create: (organizationName: string) => void;
}) {
  return (
    <CreateOrganizationDialog
      closeCreateOrganizationDialog={close}
      createOrganization={create}
      creating={false}
      error={null}
      isOpen
    />
  );
}

test("create organization dialog requires and submits an organization name", () => {
  const create = mock((_organizationName: string) => {});
  const view = render(<DialogHarness close={() => {}} create={create} />);
  const createButton = view.getByRole("button", {
    name: ORG_MANAGER_LABELS.create,
  }) as HTMLButtonElement;

  expect(createButton.disabled).toBe(true);

  fireEvent.change(view.getByLabelText(ORG_MANAGER_LABELS.organizationName), {
    target: { value: "Acme" },
  });
  fireEvent.click(createButton);

  expect(create).toHaveBeenCalledWith("Acme");
});

test("create organization dialog can be cancelled", () => {
  const close = mock(() => {});
  const view = render(<DialogHarness close={close} create={() => {}} />);

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.cancel }),
  );

  expect(close).toHaveBeenCalledTimes(1);
});

test("create organization dialog mounts as a body-level overlay", () => {
  const host = document.createElement("section");
  render(<DialogHarness close={() => {}} create={() => {}} />, {
    container: host,
  });

  expect(
    host.querySelector(".org-manager-create-organization-dialog-backdrop"),
  ).toBeNull();
  expect(
    document.body.querySelector(
      ".org-manager-create-organization-dialog-backdrop",
    ),
  ).toBeTruthy();
});
