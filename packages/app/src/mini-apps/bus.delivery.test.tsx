import { afterEach, expect, test } from "bun:test";
import {
  useCurrentWindow,
  useWindowStateData,
  WindowStateProvider,
} from "@tearleads/windowing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createMiniApps,
  EmptyMiniApp,
} from "../../test/helpers/miniAppBusFixtures";
import { AppNavigationProvider } from "../navigation/AppNavigationProvider";
import {
  MiniAppBusProvider,
  useMiniAppBusActions,
  useMiniAppMessage,
} from "./bus";
import { MiniAppWindow } from "./MiniAppWindow";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

test("messages sent back to back are all delivered in send order", async () => {
  const receivedUserIds: string[] = [];

  function ContactsProbe() {
    useMiniAppMessage("contacts", (message) => {
      receivedUserIds.push(message.userId);
    });

    return <div>Contacts Ready</div>;
  }

  function ImportTwoButton() {
    const { openMiniApp, sendMiniAppMessage } = useMiniAppBusActions();
    return (
      <button
        type="button"
        onClick={() => {
          openMiniApp({
            appId: "contacts",
            message: {
              appId: "contacts",
              type: "import-contact",
              userId: "user-1",
            },
          });
          sendMiniAppMessage({
            appId: "contacts",
            type: "import-contact",
            userId: "user-2",
          });
        }}
      >
        Import two contacts
      </button>
    );
  }

  function WindowLayer() {
    const { windows } = useWindowStateData();
    return windows.map((windowEntry) => (
      <MiniAppWindow key={windowEntry.id} windowId={windowEntry.id} />
    ));
  }

  const view = render(
    <WindowStateProvider>
      <AppNavigationProvider
        mode="windowed"
        miniApps={createMiniApps(EmptyMiniApp, ContactsProbe)}
      >
        <MiniAppBusProvider>
          <ImportTwoButton />
          <WindowLayer />
        </MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>,
  );

  fireEvent.click(view.getByRole("button", { name: "Import two contacts" }));

  await waitFor(() => {
    expect(view.getByText("Contacts Ready")).toBeTruthy();
    expect(receivedUserIds).toEqual(["user-1", "user-2"]);
  });
});

test("each message reaches exactly one subscriber of its app", async () => {
  const deliveries: string[] = [];

  function ContactsSubscriber({ name }: { name: string }) {
    useMiniAppMessage("contacts", (message) => {
      deliveries.push(`${name}:${message.userId}`);
    });

    return null;
  }

  function SendButton() {
    const { sendMiniAppMessage } = useMiniAppBusActions();
    return (
      <button
        type="button"
        onClick={() =>
          sendMiniAppMessage({
            appId: "contacts",
            type: "import-contact",
            userId: "user-1",
          })
        }
      >
        Send import
      </button>
    );
  }

  const view = render(
    <WindowStateProvider>
      <AppNavigationProvider
        mode="windowed"
        miniApps={createMiniApps(EmptyMiniApp)}
      >
        <MiniAppBusProvider>
          <ContactsSubscriber name="first" />
          <ContactsSubscriber name="second" />
          <SendButton />
        </MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>,
  );

  fireEvent.click(view.getByRole("button", { name: "Send import" }));

  await waitFor(() => {
    expect(deliveries).toEqual(["first:user-1"]);
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(deliveries).toEqual(["first:user-1"]);
});

test("a message opened into a window reaches that window, not another of the same app", async () => {
  const deliveries: string[] = [];

  function ContactsProbe() {
    const windowId = useCurrentWindow()?.id ?? "none";
    useMiniAppMessage("contacts", (message) => {
      deliveries.push(`${windowId}:${message.userId}`);
    });

    return <div>Contacts in window {windowId}</div>;
  }

  function Controls() {
    const { openMiniApp } = useMiniAppBusActions();
    return (
      <>
        <button
          type="button"
          onClick={() =>
            openMiniApp({ appId: "contacts", reuseExisting: false })
          }
        >
          Open contacts window
        </button>
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
            })
          }
        >
          Import into contacts
        </button>
      </>
    );
  }

  function WindowLayer() {
    const { windows } = useWindowStateData();
    return windows.map((windowEntry) => (
      <MiniAppWindow key={windowEntry.id} windowId={windowEntry.id} />
    ));
  }

  const view = render(
    <WindowStateProvider>
      <AppNavigationProvider
        mode="windowed"
        miniApps={createMiniApps(EmptyMiniApp, ContactsProbe)}
      >
        <MiniAppBusProvider>
          <Controls />
          <WindowLayer />
        </MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>,
  );

  const openButton = view.getByRole("button", { name: "Open contacts window" });
  fireEvent.click(openButton);
  fireEvent.click(openButton);
  await waitFor(() => {
    expect(view.getByText("Contacts in window 2")).toBeTruthy();
  });

  fireEvent.click(view.getByRole("button", { name: "Import into contacts" }));

  await waitFor(() => {
    expect(deliveries).toEqual(["2:user-1"]);
  });
});
