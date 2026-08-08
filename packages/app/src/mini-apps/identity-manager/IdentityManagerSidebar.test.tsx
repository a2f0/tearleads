import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  useWindowSidebar,
  WindowSidebarProvider,
} from "../../components/window/WindowSidebarContext";
import { useIdentityManagerSidebarPanel } from "./IdentityManagerSidebar";
import type { IdentityManagerView } from "./routes";

afterEach(cleanup);

function SidebarRegistration({
  setView,
}: {
  setView: (view: IdentityManagerView) => void;
}) {
  useIdentityManagerSidebarPanel({ setView, view: "general" });
  return null;
}

function SidebarOutput() {
  const { sidebar } = useWindowSidebar();
  return <div>{sidebar}</div>;
}

test("identity manager sidebar registers every section and navigates", async () => {
  const navigated: IdentityManagerView[] = [];
  const view = render(
    <WindowSidebarProvider>
      <SidebarRegistration setView={(next) => navigated.push(next)} />
      <SidebarOutput />
    </WindowSidebarProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("General")).toBeTruthy();
  });
  expect(view.getByText("Recovery Key")).toBeTruthy();
  expect(view.getByText("PIN Lock")).toBeTruthy();
  expect(view.getByText("Active Sessions")).toBeTruthy();
  expect(view.getByText("General").closest("button")?.className).toContain(
    "mini-app-row--selected",
  );

  fireEvent.click(view.getByText("PIN Lock"));
  expect(navigated).toEqual(["pin-lock"]);
});
