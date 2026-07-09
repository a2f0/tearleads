import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { WindowMenuProvider } from "../../components/window/WindowMenuContext";
import { WindowToolBar } from "../../components/window/WindowToolBar";
import { ORG_MANAGER_LABELS } from "./labels";
import { useOrgManagerRoutedChromeActions } from "./OrgManagerRoutedChrome";
import type { OrgManagerView } from "./routes";

afterEach(() => cleanup());

// The chrome hook, like its explorer/contacts peers, requires reference-stable
// callbacks — the toolbar re-registers whenever an action's onClick identity
// changes. Keep these at module scope so a harness re-render (which a context
// update triggers) does not hand the hook a fresh closure and loop forever.
const noop = () => undefined;

function OrgManagerRoutedChromeHarness({
  canCreateGroup = true,
  canImportRosterUser = true,
  canLoadAuthenticatedOrgData = true,
  loading = false,
  mutating = false,
  onImportUser = noop,
  onNewGroup = noop,
  view,
}: {
  canCreateGroup?: boolean;
  canImportRosterUser?: boolean;
  canLoadAuthenticatedOrgData?: boolean;
  loading?: boolean;
  mutating?: boolean;
  onImportUser?: () => void;
  onNewGroup?: () => void;
  view: OrgManagerView;
}) {
  useOrgManagerRoutedChromeActions({
    canCreateGroup,
    canImportRosterUser,
    canLoadAuthenticatedOrgData,
    loading,
    mutating,
    openCreateGroupDialog: onNewGroup,
    openImportUserDialog: onImportUser,
    view,
  });

  return <WindowToolBar />;
}

function renderChrome(ui: Parameters<typeof render>[0]) {
  return render(<WindowMenuProvider>{ui}</WindowMenuProvider>);
}

test("groups route exposes the New Group toolbar action only", async () => {
  const invoked: string[] = [];
  const view = renderChrome(
    <OrgManagerRoutedChromeHarness
      onImportUser={() => invoked.push("import")}
      onNewGroup={() => invoked.push("new-group")}
      view="groups"
    />,
  );

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
    ).toBeTruthy();
  });
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.importUserAction }),
  ).toBeNull();

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
  );
  expect(invoked).toEqual(["new-group"]);
});

test("directory route exposes the Import User toolbar action only", async () => {
  const invoked: string[] = [];
  const view = renderChrome(
    <OrgManagerRoutedChromeHarness
      onImportUser={() => invoked.push("import")}
      onNewGroup={() => invoked.push("new-group")}
      view="directory"
    />,
  );

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: ORG_MANAGER_LABELS.importUserAction }),
    ).toBeTruthy();
  });
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
  ).toBeNull();

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.importUserAction }),
  );
  expect(invoked).toEqual(["import"]);
});

test("action-less routes reserve a blank toolbar row", async () => {
  const view = renderChrome(<OrgManagerRoutedChromeHarness view="billing" />);

  await waitFor(() => {
    expect(view.container.querySelector(".window-toolbar")).not.toBeNull();
  });
  expect(view.container.querySelector(".window-toolbar-button")).toBeNull();
});

test("actions stay disabled while a mutation is in flight", async () => {
  const view = renderChrome(
    <OrgManagerRoutedChromeHarness mutating view="groups" />,
  );

  await waitFor(() => {
    expect(
      (
        view.getByRole("button", {
          name: ORG_MANAGER_LABELS.newGroupAction,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

test("New Group is disabled without create permission", async () => {
  const view = renderChrome(
    <OrgManagerRoutedChromeHarness canCreateGroup={false} view="groups" />,
  );

  await waitFor(() => {
    expect(
      (
        view.getByRole("button", {
          name: ORG_MANAGER_LABELS.newGroupAction,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

test("Import User is disabled without import permission or while loading", async () => {
  const view = renderChrome(
    <OrgManagerRoutedChromeHarness
      canImportRosterUser={false}
      view="directory"
    />,
  );
  await waitFor(() => {
    expect(
      (
        view.getByRole("button", {
          name: ORG_MANAGER_LABELS.importUserAction,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  cleanup();

  const loadingView = renderChrome(
    <OrgManagerRoutedChromeHarness loading view="directory" />,
  );
  await waitFor(() => {
    expect(
      (
        loadingView.getByRole("button", {
          name: ORG_MANAGER_LABELS.importUserAction,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

test("withholds the toolbar entirely until org data can load", () => {
  const view = renderChrome(
    <OrgManagerRoutedChromeHarness
      canLoadAuthenticatedOrgData={false}
      view="groups"
    />,
  );

  // The reservation and the route action are both gated on
  // canLoadAuthenticatedOrgData, so the pre-auth "authenticate" hint carries no
  // toolbar at all rather than a lone empty bar or a stray disabled button.
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.newGroupAction }),
  ).toBeNull();
  expect(view.container.querySelector(".window-toolbar")).toBeNull();
});
