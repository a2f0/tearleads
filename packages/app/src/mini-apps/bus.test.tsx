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
  AppNavigationProvider,
  useAppNavigationState,
} from "../navigation/AppNavigationProvider";
import {
  MiniAppBusProvider,
  useMiniAppBusActions,
  useMiniAppMessage,
} from "./bus";
import type { MiniAppDefinition, MiniAppId } from "./types";

function EmptyMiniApp() {
  return null;
}

function createMiniApps(
  orgManagerComponent: ComponentType,
  contactsComponent: ComponentType = EmptyMiniApp,
): Readonly<Record<MiniAppId, MiniAppDefinition>> {
  return {
    contacts: {
      createComponent: () => contactsComponent,
      title: "Contacts",
    },
    explorer: {
      createComponent: () => EmptyMiniApp,
      title: "Explorer",
    },
    "identity-manager": {
      createComponent: () => EmptyMiniApp,
      title: "Identity Manager",
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
  window.history.replaceState(null, "", "/");
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
      <AppNavigationProvider
        mode="windowed"
        miniApps={createMiniApps(OrgManagerProbe)}
      >
        <MiniAppBusProvider>
          <OpenButtons />
          <WindowLayer />
        </MiniAppBusProvider>
      </AppNavigationProvider>
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

test("mini-app bus opens contacts and delivers import messages", async () => {
  const receivedUserIds: string[] = [];

  function ContactsProbe() {
    useMiniAppMessage("contacts", (message) => {
      receivedUserIds.push(message.userId);
    });

    return <div>Contacts Ready</div>;
  }

  function OpenButton() {
    const { openMiniApp } = useMiniAppBusActions();
    return (
      <button
        type="button"
        onClick={() =>
          openMiniApp({
            appId: "contacts",
            message: {
              appId: "contacts",
              type: "import-contact",
              userId: "user-1",
            },
            pathSegments: ["import"],
            position: { x: 10, y: 10 },
          })
        }
      >
        Import contact
      </button>
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
      <AppNavigationProvider
        mode="windowed"
        miniApps={createMiniApps(EmptyMiniApp, ContactsProbe)}
      >
        <MiniAppBusProvider>
          <OpenButton />
          <WindowLayer />
        </MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>,
  );

  fireEvent.click(view.getByRole("button", { name: "Import contact" }));

  await waitFor(() => {
    expect(view.getByText("Contacts Ready")).toBeTruthy();
    expect(receivedUserIds).toEqual(["user-1"]);
    expect(view.getByTestId("window-count").textContent).toBe("1");
  });
});

test("mini-app bus routes target apps without windows in routed mode", async () => {
  const receivedGroupIds: string[] = [];
  const originalPushState = window.history.pushState;
  let pushedUrl: string | URL | null | undefined;
  window.history.pushState = function pushStateSpy(
    _data: unknown,
    _unused: string,
    url?: string | URL | null,
  ) {
    pushedUrl = url;
  };

  function OrgManagerProbe() {
    useMiniAppMessage("org-manager", (message) => {
      receivedGroupIds.push(message.groupId);
    });

    return <div>Routed Org Manager Ready</div>;
  }

  function OpenButton() {
    const { openMiniApp } = useMiniAppBusActions();
    return (
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
            pathSegments: ["groups", "group-1"],
            position: { x: 10, y: 10 },
          })
        }
      >
        Open routed group
      </button>
    );
  }

  function RoutedLayer() {
    const {
      route: { appId },
    } = useAppNavigationState();
    const { windows } = useWindowStateData();

    return (
      <>
        <div data-testid="window-count">{windows.length}</div>
        {appId === "org-manager" && <OrgManagerProbe />}
      </>
    );
  }

  try {
    const view = render(
      <WindowStateProvider>
        <AppNavigationProvider
          mode="routed"
          miniApps={createMiniApps(OrgManagerProbe)}
        >
          <MiniAppBusProvider>
            <OpenButton />
            <RoutedLayer />
          </MiniAppBusProvider>
        </AppNavigationProvider>
      </WindowStateProvider>,
    );

    fireEvent.click(view.getByRole("button", { name: "Open routed group" }));

    await waitFor(() => {
      expect(pushedUrl).toBe("/app/org-manager/groups/group-1");
      expect(view.getByText("Routed Org Manager Ready")).toBeTruthy();
      expect(receivedGroupIds).toEqual(["group-1"]);
      expect(view.getByTestId("window-count").textContent).toBe("0");
    });
  } finally {
    window.history.pushState = originalPushState;
  }
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
      <AppNavigationProvider
        mode="windowed"
        miniApps={createMiniApps(EmptyMiniApp)}
      >
        <MiniAppBusProvider>
          <ActionConsumer />
          <CreateWindowButton />
          <WindowCounter />
        </MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>,
  );

  expect(view.getByTestId("action-renders").textContent).toBe("1");
  expect(view.getByTestId("window-count").textContent).toBe("0");

  fireEvent.click(view.getByRole("button", { name: "Add window" }));

  expect(view.getByTestId("window-count").textContent).toBe("1");
  expect(view.getByTestId("action-renders").textContent).toBe("1");
});
