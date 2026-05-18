import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  useWindowSidebar,
  WindowSidebarProvider,
} from "../../components/window/WindowSidebarContext";
import { ORG_MANAGER_LABELS } from "./labels";
import {
  type OrgManagerView,
  useOrgManagerSidebarPanel,
} from "./OrgManagerSidebar";

afterEach(() => cleanup());

function setView(_view: OrgManagerView) {}

function SidebarRegistration({ enabled }: { enabled: boolean }) {
  useOrgManagerSidebarPanel({
    enabled,
    setView,
    view: "directory",
  });

  return null;
}

function SidebarOutput() {
  const { sidebar } = useWindowSidebar();
  return <div>{sidebar}</div>;
}

function SidebarHarness({ enabled }: { enabled: boolean }) {
  return (
    <WindowSidebarProvider>
      <SidebarRegistration enabled={enabled} />
      <SidebarOutput />
    </WindowSidebarProvider>
  );
}

test("org manager sidebar panel clears itself when disabled", async () => {
  const view = render(<SidebarHarness enabled />);

  await waitFor(() => {
    expect(view.getByText(ORG_MANAGER_LABELS.directory)).toBeTruthy();
    expect(view.getByText(ORG_MANAGER_LABELS.groups)).toBeTruthy();
    expect(view.getByText(ORG_MANAGER_LABELS.grants)).toBeTruthy();
    expect(view.getByText(ORG_MANAGER_LABELS.usage)).toBeTruthy();
  });

  view.rerender(<SidebarHarness enabled={false} />);

  await waitFor(() => {
    expect(view.queryByText(ORG_MANAGER_LABELS.directory)).toBeNull();
  });
});
