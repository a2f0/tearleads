import { afterEach, expect, mock, test } from "bun:test";
import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { RevokeGrantConfirmationDialog } from "./RevokeGrantConfirmationDialog";

afterEach(() => cleanup());

const grant: OrganizationContainerGrant = {
  accessLevel: "write",
  containerDisplayName: "Roadmap",
  containerId: "container-1",
  createdAt: "2026-05-20T12:00:00.000Z",
  depth: 0,
  groupId: "group-1",
  groupName: "Editors",
  isBuiltin: false,
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "access-state-hash",
  metadataDocumentId: null,
  parentId: null,
  signingKeyFingerprint: null,
  subjectId: "group-1",
  subjectType: "group",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: null,
};

test("revoke grant confirmation dialog summarizes the grant and confirms", () => {
  const onConfirm = mock(() => {});
  const view = render(
    <RevokeGrantConfirmationDialog
      busy={false}
      grant={grant}
      onCancel={() => {}}
      onConfirm={onConfirm}
    />,
  );

  expect(
    view.getByRole("dialog", {
      name: ORG_MANAGER_LABELS.revokeGrantConfirmationTitle,
    }),
  ).toBeTruthy();
  expect(view.getByText("Editors")).toBeTruthy();
  expect(view.getByText("Roadmap")).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.accessWrite)).toBeTruthy();

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.revoke }),
  );

  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test("revoke grant confirmation dialog can be cancelled", () => {
  const onCancel = mock(() => {});
  const onConfirm = mock(() => {});
  const view = render(
    <RevokeGrantConfirmationDialog
      busy={false}
      grant={grant}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.cancel }),
  );

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledTimes(0);
});

test("revoke grant confirmation dialog does not submit while busy", () => {
  const onConfirm = mock(() => {});
  const view = render(
    <RevokeGrantConfirmationDialog
      busy
      grant={grant}
      onCancel={() => {}}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.revokingGrant }),
  );

  expect(onConfirm).toHaveBeenCalledTimes(0);
});
