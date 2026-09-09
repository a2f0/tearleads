import { expect } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { useEffect } from "react";
import { usePaneSide } from "../../../src/components/pane/dual-pane";
import { useTearleads } from "../../../src/providers/sdk/TearleadsProvider";
import { waitForAppTestRuntimeToSettle } from "../appRuntimeIdle";
import { listProxiedApiRequests } from "../mswServer";
import { waitForCondition } from "../waitForCondition";
import {
  getPaneRoot,
  interact,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "./dualPaneCore";

function CapturePeerRuntime({
  runtimes,
}: {
  runtimes: Partial<Record<"left" | "right", Tearleads>>;
}) {
  const side = usePaneSide();
  const tearleads = useTearleads();
  useEffect(() => {
    runtimes[side] = tearleads;
  }, [runtimes, side, tearleads]);
  return null;
}

export async function renderSeededDemo(): Promise<{
  view: ReturnType<typeof renderDualPane>;
  leftPane: HTMLElement;
  rightPane: HTMLElement;
  leftRuntime: Tearleads;
  rightRuntime: Tearleads;
}> {
  const startIndex = listProxiedApiRequests().length;
  const runtimes: Partial<Record<"left" | "right", Tearleads>> = {};
  const view = renderDualPane({
    seedPeerIdentities: true,
    children: <CapturePeerRuntime runtimes={runtimes} />,
  });
  const leftPane = getPaneRoot(view, "left");
  const rightPane = getPaneRoot(view, "right");
  await waitForDualPaneProvisioning(leftPane, rightPane);
  await waitForCondition(
    () =>
      listProxiedApiRequests()
        .slice(startIndex)
        .filter(
          (request) =>
            request.method === "PUT" &&
            request.status === 200 &&
            request.url.endsWith("/policy-commit"),
        ).length >= 2,
    "Demo peer roster seeding did not finish.",
  );
  // The demo imports both peers before the user edits group membership.
  await act(async () => {
    expect(
      await waitForAppTestRuntimeToSettle({
        apiQuietMs: 500,
        timeoutMs: 15_000,
      }),
    ).toBe(true);
  });
  invariant(runtimes.left && runtimes.right, "Expected both peer runtimes.");
  return {
    view,
    leftPane,
    rightPane,
    leftRuntime: runtimes.left,
    rightRuntime: runtimes.right,
  };
}

export async function openMiniApp(
  pane: HTMLElement,
  name: "Notes" | "Contacts",
) {
  const count = pane.querySelectorAll(".window").length;
  await interact(() => {
    fireEvent.contextMenu(pane, { clientX: 160, clientY: 160 });
  });
  await interact(() => fireEvent.click(screen.getByRole("button", { name })));
  return waitFor(() => {
    const windows = pane.querySelectorAll<HTMLElement>(".window");
    expect(windows.length).toBeGreaterThan(count);
    const window = windows[windows.length - 1];
    invariant(window, `Expected ${name} window.`);
    return window;
  });
}

export async function typeMiniAppNote(window: HTMLElement, text: string) {
  const editor = await within(window).findByRole("textbox", {
    name: /Notes editor/u,
  });
  await waitFor(() => {
    expect(editor.hasAttribute("disabled")).toBe(false);
    expect(editor.hasAttribute("readonly")).toBe(false);
  });
  await interact(() => fireEvent.change(editor, { target: { value: text } }));
  await within(window).findByRole("button", { name: text });
}

async function openContactAction(window: HTMLElement, name: string) {
  await interact(() =>
    fireEvent.click(within(window).getByRole("menuitem", { name: "File" })),
  );
  const action = await within(window).findByRole("menuitem", { name });
  await waitFor(() => expect(action.hasAttribute("disabled")).toBe(false));
  await interact(() => fireEvent.click(action));
}

export async function importMiniAppContact(
  window: HTMLElement,
  userId: string,
) {
  await openContactAction(window, "Import Contact");
  const input = await within(window).findByRole("textbox", {
    name: "Contact user ID",
  });
  await interact(() => fireEvent.change(input, { target: { value: userId } }));
  await interact(() =>
    fireEvent.click(within(window).getByRole("button", { name: "Import" })),
  );
  await within(window).findByRole("button", { name: "Edit" });
}

export async function createMiniAppContact(window: HTMLElement, title: string) {
  await openContactAction(window, "New Contact");
  const nickname = await within(window).findByRole("textbox", {
    name: "Nickname",
  });
  await interact(() =>
    fireEvent.change(nickname, { target: { value: title } }),
  );
  await interact(() =>
    fireEvent.click(within(window).getByRole("button", { name: "Create" })),
  );
  await within(window).findByRole("button", { name: "Edit" });
}

export async function editMiniAppContact(window: HTMLElement, title: string) {
  const edit = within(window).queryByRole("button", { name: "Edit" });
  if (edit) await interact(() => fireEvent.click(edit));
  const nickname = await within(window).findByRole("textbox", {
    name: "Nickname",
  });
  await interact(() =>
    fireEvent.change(nickname, { target: { value: title } }),
  );
  await interact(() => fireEvent.blur(nickname));
  await within(window).findByRole("button", { name: title });
}
