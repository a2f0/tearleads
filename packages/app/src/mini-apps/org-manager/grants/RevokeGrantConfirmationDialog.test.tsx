import { afterEach, expect, mock, test } from "bun:test";
import {
  createDomainScope,
  type OrganizationContainerGrant,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { ORG_MANAGER_BUSY_LABELS } from "./busyLabels";
import { RevokeGrantConfirmationDialog } from "./RevokeGrantConfirmationDialog";

import { useRevokeGrantConfirmation } from "./useRevokeGrantConfirmation";

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

test("revoke grant confirmation dialog covers itself and does not submit while busy", () => {
  const onConfirm = mock(() => {});
  const view = render(
    <RevokeGrantConfirmationDialog
      busy
      grant={grant}
      onCancel={() => {}}
      onConfirm={onConfirm}
    />,
  );

  // The in-flight revoke cannot be cancelled, so the whole panel shows one
  // busy overlay rather than a spinner in the button.
  const status = view.getByRole("status");
  expect(status.className).toBe("mini-app-modal-busy");
  expect(status.textContent).toContain(ORG_MANAGER_BUSY_LABELS.revokingGrant);

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.revoke }),
  );

  expect(onConfirm).toHaveBeenCalledTimes(0);
});

test("grant confirmation expires across sign-ins to the same organization", () => {
  const first = {
    containerId: "root",
    domainScope: createDomainScope(),
    generation: {},
    organizationId: "org",
    signingFingerprint: "identity",
    userId: "user",
  };
  let scope = first;
  const revokeGrant = mock(async () => {});
  const { result, rerender } = renderHook(() =>
    useRevokeGrantConfirmation({
      captureOperationScope: () => scope,
      isOperationScopeActive: (owner) => owner === scope,
      organizationId: "org",
      canRevokeGrants: true,
      mutating: false,
      revokeGrant,
    }),
  );
  act(() => result.current.requestRevokeGrant(grant));
  expect(result.current.grantPendingRevoke).toEqual(grant);
  const confirm = result.current.confirmRevokeGrant;
  scope = { ...first, domainScope: createDomainScope() };
  act(confirm);
  rerender();
  expect(revokeGrant).not.toHaveBeenCalled();
  expect(result.current.grantPendingRevoke).toBeNull();
});
