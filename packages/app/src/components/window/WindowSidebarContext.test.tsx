import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
  WindowSidebarProvider,
} from "./WindowSidebarContext";

afterEach(() => cleanup());

function SidebarRegistration({
  enabled,
  label,
}: {
  enabled: boolean;
  label: string;
}) {
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(() => <span>{label}</span>, [label]);
  useRegisteredWindowSidebar({ enabled, setSidebar, sidebar });

  return null;
}

function SidebarOutput() {
  const { sidebar } = useWindowSidebar();
  return <div>{sidebar}</div>;
}

function DisabledRegistrationHarness() {
  return (
    <WindowSidebarProvider>
      <SidebarRegistration enabled label="Active sidebar" />
      <SidebarRegistration enabled={false} label="Disabled sidebar" />
      <SidebarOutput />
    </WindowSidebarProvider>
  );
}

function SidebarHarness({
  enabled,
  label = "Registered sidebar",
}: {
  enabled: boolean;
  label?: string;
}) {
  return (
    <WindowSidebarProvider>
      <SidebarRegistration enabled={enabled} label={label} />
      <SidebarOutput />
    </WindowSidebarProvider>
  );
}

test("registered window sidebar updates and clears itself when disabled", async () => {
  const view = render(<SidebarHarness enabled label="First sidebar" />);

  await waitFor(() => {
    expect(view.getByText("First sidebar")).toBeTruthy();
  });

  view.rerender(<SidebarHarness enabled label="Updated sidebar" />);

  await waitFor(() => {
    expect(view.queryByText("First sidebar")).toBeNull();
    expect(view.getByText("Updated sidebar")).toBeTruthy();
  });

  view.rerender(<SidebarHarness enabled={false} label="Updated sidebar" />);

  await waitFor(() => {
    expect(view.queryByText("Updated sidebar")).toBeNull();
  });
});

test("disabled window sidebar registration does not clear another active sidebar", async () => {
  const view = render(<DisabledRegistrationHarness />);

  await waitFor(() => {
    expect(view.getByText("Active sidebar")).toBeTruthy();
    expect(view.queryByText("Disabled sidebar")).toBeNull();
  });
});
