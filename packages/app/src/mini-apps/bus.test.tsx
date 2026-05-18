import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { Window } from "../components/window/Window";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "../components/window/WindowStateProvider";
import {
  MiniAppBusProvider,
  type MiniAppDefinition,
  type MiniAppId,
  useMiniAppBusActions,
  useMiniAppMessage,
} from "./bus";

function EmptyMiniApp() {
  return null;
}

function createMiniApps(
  orgManagerComponent: ComponentType,
): Readonly<Record<MiniAppId, MiniAppDefinition>> {
  return {
    contacts: {
      createComponent: () => EmptyMiniApp,
      title: "Contacts",
    },
    explorer: {
      createComponent: () => EmptyMiniApp,
      title: "Explorer",
    },
    notes: {
      createComponent: () => EmptyMiniApp,
      title: "Notes",
    },
    "org-manager": {
      createComponent: () => orgManagerComponent,
      title: "Org Manager",
    },
  };
}

afterEach(() => {
  cleanup();
});

test("mini-app bus opens a target app and delivers route messages", async () => {
  const receivedGroupIds: string[] = [];

  function OrgManagerProbe() {
    useMiniAppMessage("org-manager", (message) => {
      receivedGroupIds.push(message.groupId);
    });

    return <div>Org Manager Ready</div>;
  }

  function OpenButtons() {
    const { openMiniApp } = useMiniAppBusActions();
    return (
      <>
        <button
          type="button"
          onClick={() =>
            openMiniApp({
              appId: "org-manager",
              message: {
                appId: "org-manager",
                groupId: "group-1",
                type: "open-group",
              },
              position: { x: 10, y: 10 },
            })
          }
        >
          Open group 1
        </button>
        <button
          type="button"
          onClick={() =>
            openMiniApp({
              appId: "org-manager",
              message: {
                appId: "org-manager",
                groupId: "group-2",
                type: "open-group",
              },
              position: { x: 20, y: 20 },
            })
          }
        >
          Open group 2
        </button>
      </>
    );
  }

  function WindowLayer() {
    const { windows } = useWindowStateData();
    return (
      <>
        <div data-testid="window-count">{windows.length}</div>
        {windows.map((windowEntry) => (
          <Window key={windowEntry.id} windowId={windowEntry.id} />
        ))}
      </>
    );
  }

  const view = render(
    <WindowStateProvider>
      <MiniAppBusProvider miniApps={createMiniApps(OrgManagerProbe)}>
        <OpenButtons />
        <WindowLayer />
      </MiniAppBusProvider>
    </WindowStateProvider>,
  );

  fireEvent.click(view.getByRole("button", { name: "Open group 1" }));

  await waitFor(() => {
    expect(view.getByText("Org Manager Ready")).toBeTruthy();
    expect(receivedGroupIds).toEqual(["group-1"]);
    expect(view.getByTestId("window-count").textContent).toBe("1");
  });

  fireEvent.click(view.getByRole("button", { name: "Open group 2" }));

  await waitFor(() => {
    expect(receivedGroupIds).toEqual(["group-1", "group-2"]);
    expect(view.getByTestId("window-count").textContent).toBe("1");
  });
});

test("mini-app bus action consumers do not re-render on window state changes", () => {
  let actionRenderCount = 0;

  function ActionConsumer() {
    actionRenderCount += 1;
    useMiniAppBusActions();

    return <div data-testid="action-renders">{actionRenderCount}</div>;
  }

  function CreateWindowButton() {
    const { create } = useWindowActions();

    return (
      <button type="button" onClick={() => create("Window", 0, 0)}>
        Add window
      </button>
    );
  }

  function WindowCounter() {
    const { windows } = useWindowStateData();

    return <div data-testid="window-count">{windows.length}</div>;
  }

  const view = render(
    <WindowStateProvider>
      <MiniAppBusProvider miniApps={createMiniApps(EmptyMiniApp)}>
        <ActionConsumer />
        <CreateWindowButton />
        <WindowCounter />
      </MiniAppBusProvider>
    </WindowStateProvider>,
  );

  expect(view.getByTestId("action-renders").textContent).toBe("1");
  expect(view.getByTestId("window-count").textContent).toBe("0");

  fireEvent.click(view.getByRole("button", { name: "Add window" }));

  expect(view.getByTestId("window-count").textContent).toBe("1");
  expect(view.getByTestId("action-renders").textContent).toBe("1");
});
