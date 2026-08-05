import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ROUTED_TABLET_QUERY } from "../../../navigation/breakpoints";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { compactFingerprint } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { DirectoryTable } from "./DirectoryTable";

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.window ?? {},
  "matchMedia",
);
const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.HTMLElement?.prototype ?? {},
  "clientWidth",
);

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
  globalThis.localStorage.clear();

  if (originalClientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidthDescriptor,
    );
  }

  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

// happy-dom has no layout engine, so every clientWidth is 0 — which the fold
// predicate reads as "not measured" and ignores. Stand in for the layout the
// browser would do, which is the only way to exercise the width-driven fold
// outside Playwright.
function mockFrameWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
}

function mockRoutedLayout(tablet = false) {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: query === ROUTED_TABLET_QUERY && tablet,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}

const rosterUser: OrganizationDirectoryUser = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: false,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: "550e8400-e29b-41d4-a716-446655440000",
};

const directory: OrganizationDirectory = {
  currentUser: { isOrgAdmin: true },
  organizationId: "organization-1",
  profileDocumentId: null,
  users: [rosterUser],
};

test("org manager directory table renders two-line rows on phones", () => {
  mockRoutedLayout();
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );
  const table = view.getByRole("table", {
    name: ORG_MANAGER_LABELS.directory,
  });
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
    [ORG_MANAGER_LABELS.user],
    [ORG_MANAGER_LABELS.status, ORG_MANAGER_LABELS.joined],
  ]);
  expect(
    bodyLines.map((line) =>
      Array.from(
        line.querySelectorAll(".mini-app-compact-table-field"),
        (field) => field.textContent,
      ),
    ),
  ).toEqual([
    [`${ORG_MANAGER_LABELS.user}: ${compactFingerprint(rosterUser.userId)}`],
    [
      `${ORG_MANAGER_LABELS.status}: ${ORG_MANAGER_LABELS.active}`,
      `${ORG_MANAGER_LABELS.joined}: ${formatMiniAppDate(rosterUser.joinedAt)}`,
    ],
  ]);

  const columnsButton = view.getByRole("button", {
    name: ORG_MANAGER_LABELS.columns,
  });
  const actionsButton = view.getByRole("button", {
    name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${compactFingerprint(rosterUser.userId)}`,
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

test("org manager directory table stays single-line in narrow windowed mode", () => {
  mockRoutedLayout();
  document.documentElement.setAttribute("data-navigation-mode", "windowed");
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );
  const table = view.getByRole("table", {
    name: ORG_MANAGER_LABELS.directory,
  });

  expect(table.querySelector(".mini-app-compact-table-lines")).toBeNull();
  expect(
    table.querySelectorAll(
      "tbody .mini-app-table-row:not(.mini-app-virtual-table-spacer-row) td",
    ),
  ).toHaveLength(3);
  const frame = table.parentElement;
  expect(frame?.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame?.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "36px",
  );
});

test("org manager directory table folds when its own frame is narrow", () => {
  // A desktop window squeezed narrow, or a table beside a dragged-open sidebar:
  // the viewport is wide and windowed, but the table's frame is not.
  document.documentElement.setAttribute("data-navigation-mode", "windowed");
  mockFrameWidth(320);
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );
  const table = view.getByRole("table", {
    name: ORG_MANAGER_LABELS.directory,
  });

  expect(table.querySelector(".mini-app-compact-table-lines")).not.toBeNull();
  const frame = table.parentElement;
  expect(frame?.classList.contains("mini-app-table-frame--two-line")).toBe(
    true,
  );
  expect(frame?.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
  // The columns menu survives the fold on a pane-driven table — unlike a phone,
  // a desktop user can still reach it.
  expect(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.columns }),
  ).toBeTruthy();
});

test("org manager directory table stays single-line in a wide frame", () => {
  document.documentElement.setAttribute("data-navigation-mode", "windowed");
  mockFrameWidth(900);
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );
  const table = view.getByRole("table", {
    name: ORG_MANAGER_LABELS.directory,
  });

  expect(table.querySelector(".mini-app-compact-table-lines")).toBeNull();
  const frame = table.parentElement;
  expect(frame?.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame?.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "36px",
  );
});

test("org manager directory table stays single-line on routed tablets", () => {
  mockRoutedLayout(true);
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );
  const table = view.getByRole("table", {
    name: ORG_MANAGER_LABELS.directory,
  });

  expect(table.querySelector(".mini-app-compact-table-lines")).toBeNull();
  const frame = table.parentElement;
  expect(frame?.classList.contains("mini-app-table-frame--two-line")).toBe(
    false,
  );
  expect(frame?.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "36px",
  );
});

test("org manager directory table has no kebab on the desktop layout", () => {
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );

  expect(
    view.queryByRole("button", {
      name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${compactFingerprint(rosterUser.userId)}`,
    }),
  ).toBeNull();
});

test("org manager directory table opens the row context menu from the touch kebab", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const contextMenuUserIds: string[] = [];
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={(event, userId) => {
        event.preventDefault();
        contextMenuUserIds.push(userId);
      }}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${compactFingerprint(rosterUser.userId)}`,
    }),
  );

  expect(contextMenuUserIds).toEqual([rosterUser.userId]);
});

test("org manager directory columns menu rides the touch actions header", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={() => undefined}
    />,
  );
  const lastHeaderCell = Array.from(
    view.container.querySelectorAll("thead th"),
  ).at(-1);
  const columnsButton = view.getByRole("button", {
    name: ORG_MANAGER_LABELS.columns,
  });

  // The kebab column is the table's trailing edge here, so the trigger rides
  // in its header instead of sitting one narrow column in from the edge.
  expect(
    lastHeaderCell?.classList.contains("mini-app-row-actions-column"),
  ).toBe(true);
  expect(lastHeaderCell?.contains(columnsButton)).toBe(true);
});

test("org manager directory kebab keeps keyboard activation off the row", () => {
  // Enter/Space on the focused kebab must not bubble to the row's onKeyDown and
  // navigate into the user detail instead of opening the kebab menu.
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const selectedUserIds: string[] = [];
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      openRosterUserContextMenu={() => undefined}
      selectedUserId={null}
      selectUser={(userId) => selectedUserIds.push(userId)}
    />,
  );
  const actionsButton = view.getByRole("button", {
    name: `${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${compactFingerprint(rosterUser.userId)}`,
  });

  fireEvent.keyDown(actionsButton, { key: "Enter" });
  fireEvent.keyDown(actionsButton, { key: " " });

  expect(selectedUserIds).toEqual([]);
});

test("an unfetched roster reads as loading rather than unavailable", () => {
  // Before the first directory pass settles there is no projection to show.
  // Reporting that as "unavailable" told the user the roster was missing when
  // it had simply not been fetched yet.
  const view = render(<DirectoryTable directory={null} pending={true} />);

  expect(view.getByText(ORG_MANAGER_LABELS.loadingDirectory)).toBeTruthy();
  expect(view.queryByText(ORG_MANAGER_LABELS.directoryUnavailable)).toBeNull();
});

test("a settled empty roster reports itself as unavailable", () => {
  const view = render(<DirectoryTable directory={null} pending={false} />);

  expect(view.getByText(ORG_MANAGER_LABELS.directoryUnavailable)).toBeTruthy();
});

test("an active roster user without an assigned seat is marked as unable to sync", () => {
  const view = render(
    <DirectoryTable
      directory={directory}
      pending={false}
      syncSeatUserIds={new Set()}
    />,
  );

  expect(view.getByText(ORG_MANAGER_LABELS.syncSeatUnavailable)).toBeTruthy();
});
