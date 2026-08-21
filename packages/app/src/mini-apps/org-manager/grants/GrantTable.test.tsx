import { afterEach, expect, test } from "bun:test";
import type { OrganizationContainerGrant } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { getGrantPrincipalLabel } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerGrantRouteRef } from "../routes";
import { GrantTable } from "./GrantTable";

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.window ?? {},
  "matchMedia",
);

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
  globalThis.localStorage.clear();

  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

function mockPhoneRoutedLayout() {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}

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

test("org manager grant table renders two-line rows on phones", () => {
  mockPhoneRoutedLayout();
  const view = render(
    <GrantTable
      canRevokeGrants
      emptyLabel={ORG_MANAGER_LABELS.noDirectContainerLinks}
      grants={[grant]}
      label={ORG_MANAGER_LABELS.grants}
      mutating={false}
      openGrantContextMenu={() => undefined}
      openGrantRoute={() => undefined}
      revokeGrant={() => undefined}
    />,
  );
  const table = view.getByRole("table", { name: ORG_MANAGER_LABELS.grants });
  const headerLines = Array.from(
    table.querySelectorAll("thead .mini-app-compact-table-line"),
  );
  const bodyLines = Array.from(
    table.querySelectorAll("tbody .mini-app-compact-table-line"),
  );

  expect(headerLines).toHaveLength(2);
  expect(bodyLines).toHaveLength(2);
  expect(
    headerLines.map((line) =>
      Array.from(
        line.querySelectorAll(".mini-app-compact-table-field"),
        (field) => field.textContent,
      ),
    ),
  ).toEqual([
    [ORG_MANAGER_LABELS.principal, ORG_MANAGER_LABELS.container],
    [ORG_MANAGER_LABELS.access, ORG_MANAGER_LABELS.updated],
  ]);
  expect(
    bodyLines.map((line) =>
      Array.from(
        line.querySelectorAll(".mini-app-compact-table-field"),
        (field) => field.textContent,
      ),
    ),
  ).toEqual([
    [
      `${ORG_MANAGER_LABELS.principal}: Admins`,
      `${ORG_MANAGER_LABELS.container}: Root`,
    ],
    [
      `${ORG_MANAGER_LABELS.access}: ${ORG_MANAGER_LABELS.accessAdmin}`,
      `${ORG_MANAGER_LABELS.updated}: ${formatMiniAppDate(grant.updatedAt)}`,
    ],
  ]);

  const columnsButton = view.getByRole("button", {
    name: ORG_MANAGER_LABELS.columns,
  });
  const actionsButton = view.getByRole("button", {
    name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${getGrantPrincipalLabel(grant)}`,
  });
  expect(table.querySelector("thead")?.contains(columnsButton)).toBe(true);
  expect(table.querySelector("tbody")?.contains(actionsButton)).toBe(true);

  const frame = table.parentElement;
  expect(frame?.classList.contains("mini-app-table-frame--two-line")).toBe(
    true,
  );
  expect(frame?.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
});

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

test("org manager grant table swaps the inline revoke for a touch kebab", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const customGrant = {
    ...grant,
    isBuiltin: false,
  } satisfies OrganizationContainerGrant;
  const opened: OrganizationContainerGrant[] = [];
  const view = render(
    <GrantTable
      canRevokeGrants
      emptyLabel={ORG_MANAGER_LABELS.noDirectContainerLinks}
      grants={[customGrant]}
      label={ORG_MANAGER_LABELS.grants}
      mutating={false}
      openGrantContextMenu={(_event, grantArg) => opened.push(grantArg)}
      openGrantRoute={() => undefined}
      revokeGrant={() => undefined}
    />,
  );

  // The inline Revoke button is replaced by the kebab on touch.
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.revoke }),
  ).toBeNull();
  const actionsButton = view.getByRole("button", {
    name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${getGrantPrincipalLabel(customGrant)}`,
  });

  fireEvent.click(actionsButton);

  expect(opened).toEqual([customGrant]);
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
