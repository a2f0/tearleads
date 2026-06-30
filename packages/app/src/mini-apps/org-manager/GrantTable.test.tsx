import { afterEach, expect, test } from "bun:test";
import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GrantTable } from "./GrantTable";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerGrantRouteRef } from "./routes";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

const grant: OrganizationContainerGrant = {
  accessLevel: "admin",
  containerDisplayName: "Root",
  containerId: "container-1",
  createdAt: "2026-05-20T12:00:00.000Z",
  depth: 0,
  groupId: "group-1",
  groupName: "Admins",
  isBuiltin: true,
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "access-state-hash",
  metadataDocumentId: null,
  organizationName: null,
  parentId: null,
  signingKeyFingerprint: null,
  subjectId: "group-1",
  subjectType: "group",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: null,
};

function renderGrantTable(
  grants: ReadonlyArray<OrganizationContainerGrant>,
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void = () => undefined,
) {
  return render(
    <GrantTable
      canRevokeGrants
      emptyLabel={ORG_MANAGER_LABELS.noDirectContainerLinks}
      grants={grants}
      label={ORG_MANAGER_LABELS.grants}
      mutating={false}
      openGrantRoute={openGrantRoute}
      revokeGrant={() => undefined}
    />,
  );
}

test("org manager grant table renders built-in grants as plain text", () => {
  const view = renderGrantTable([grant]);

  expect(view.getByText(ORG_MANAGER_LABELS.builtIn)).toBeTruthy();
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.builtIn }),
  ).toBeNull();
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.revoke }),
  ).toBeNull();
});

test("org manager grant table keeps revoke action for custom grants", () => {
  const view = renderGrantTable([{ ...grant, isBuiltin: false }]);

  expect(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.revoke }),
  ).toBeTruthy();
});

test("org manager grant table toggles optional columns", () => {
  const view = renderGrantTable([grant]);

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.columns }),
  );
  fireEvent.click(
    view.getByRole("checkbox", {
      name: `${ORG_MANAGER_LABELS.updated} ${ORG_MANAGER_LABELS.columnsMenuStateOn}`,
    }),
  );

  const table = view.getByRole("table", { name: ORG_MANAGER_LABELS.grants });
  const headerText = Array.from(table.querySelectorAll("thead th")).map(
    (header) => header.textContent,
  );

  expect(headerText).not.toContain(ORG_MANAGER_LABELS.updated);
  expect(table.textContent).toContain(ORG_MANAGER_LABELS.builtIn);
});

test("org manager grant table opens grant detail routes from rows", () => {
  const openedGrantRefs: OrgManagerGrantRouteRef[] = [];
  const userGrant = {
    ...grant,
    groupId: null,
    groupName: null,
    subjectId: "user-1",
    subjectType: "user",
    userId: "user-1",
  } satisfies OrganizationContainerGrant;
  const view = renderGrantTable([userGrant], (grantRef) => {
    openedGrantRefs.push(grantRef);
  });

  fireEvent.click(view.getByText("user-1"));

  expect(openedGrantRefs).toEqual([
    {
      containerId: "container-1",
      subjectId: "user-1",
      subjectType: "user",
    },
  ]);
});
