import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Window } from "../components/window/Window";
import {
  useWindowStateData,
  WindowStateProvider,
} from "../components/window/WindowStateProvider";
import type { MiniAppDefinition, MiniAppId } from "../mini-apps/types";
import {
  AppNavigationProvider,
  parseAppRoute,
  useAppNavigationActions,
  useAppNavigationState,
  useMiniAppRouteSegments,
} from "./AppNavigationProvider";

const EmptyMiniApp = () => null;

function ContactsRouteProbe() {
  const { pathSegments, setPathSegments } = useMiniAppRouteSegments("contacts");

  return (
    <>
      <button
        type="button"
        onClick={() => setPathSegments(["contact", "grace"])}
      >
        Select Grace
      </button>
      <div data-testid="contacts-window-path">{pathSegments.join("/")}</div>
    </>
  );
}

const TEST_MINI_APPS: Readonly<Record<MiniAppId, MiniAppDefinition>> = {
  "backup-restore": { createComponent: () => EmptyMiniApp, title: "Backup" },
  contacts: { createComponent: () => ContactsRouteProbe, title: "Contacts" },
  explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  "identity-manager": { createComponent: () => EmptyMiniApp, title: "ID" },
  notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
  "org-manager": { createComponent: () => EmptyMiniApp, title: "Org Manager" },
  "system-monitor": {
    createComponent: () => EmptyMiniApp,
    title: "System Monitor",
  },
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function NavigationProbe() {
  const { goBack, goForward, navigateMiniAppRoute, openMiniApp } =
    useAppNavigationActions();
  const {
    history,
    route: { appId, pathSegments },
  } = useAppNavigationState();
  const contactsRoute = useMiniAppRouteSegments("contacts");
  const { windows } = useWindowStateData();

  return (
    <>
      <button type="button" onClick={() => openMiniApp({ appId: "contacts" })}>
        Open Contacts
      </button>
      <button
        type="button"
        onClick={() =>
          openMiniApp({
            appId: "contacts",
            pathSegments: ["contact", "ada"],
          })
        }
      >
        Open Contacts at Ada
      </button>
      <button
        type="button"
        onClick={() =>
          openMiniApp({
            appId: "contacts",
            pathSegments: ["contact", "hopper"],
          })
        }
      >
        Open Contacts at Hopper
      </button>
      <button
        type="button"
        onClick={() =>
          navigateMiniAppRoute({
            appId: "contacts",
            pathSegments: ["contact", "ada"],
          })
        }
      >
        Open Ada
      </button>
      <button
        type="button"
        onClick={() =>
          navigateMiniAppRoute({
            appId: "contacts",
            pathSegments: ["contact", "ada"],
            replace: true,
          })
        }
      >
        Replace Ada
      </button>
      <button type="button" onClick={goBack}>
        Go Back
      </button>
      <button type="button" onClick={goForward}>
        Go Forward
      </button>
      <div data-testid="active-app">{appId ?? "none"}</div>
      <div data-testid="active-path">{pathSegments.join("/")}</div>
      <div data-testid="can-go-back">{String(history.canGoBack)}</div>
      <div data-testid="can-go-forward">{String(history.canGoForward)}</div>
      <div data-testid="contacts-path">
        {contactsRoute.pathSegments.join("/")}
      </div>
      <div data-testid="window-count">{windows.length}</div>
      {windows.map((windowEntry) => (
        <Window key={windowEntry.id} windowId={windowEntry.id} />
      ))}
    </>
  );
}

function createAppNavigationHistoryState(index: number, entries: number) {
  return {
    __tearleadsAppNavigation: {
      entries,
      index,
    },
  };
}

function readAppNavigationHistoryState(state: unknown) {
  if (typeof state !== "object" || state === null) {
    return null;
  }

  return (
    state as {
      __tearleadsAppNavigation?: { entries: number; index: number };
    }
  ).__tearleadsAppNavigation;
}

function spyPushState(
  onPush: (data: unknown, url: string | URL | null | undefined) => void,
) {
  const originalPushState = window.history.pushState;
  window.history.pushState = function pushStateSpy(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    onPush(data, url);
    return originalPushState.call(window.history, data, unused, url);
  };
  return () => {
    window.history.pushState = originalPushState;
  };
}

function spyReplaceState(
  onReplace: (data: unknown, url: string | URL | null | undefined) => void,
) {
  const originalReplaceState = window.history.replaceState;
  window.history.replaceState = function replaceStateSpy(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    onReplace(data, url);
    return originalReplaceState.call(window.history, data, unused, url);
  };
  return () => {
    window.history.replaceState = originalReplaceState;
  };
}

function renderNavigationProbe(mode: "routed" | "windowed") {
  return render(
    <WindowStateProvider>
      <AppNavigationProvider mode={mode} miniApps={TEST_MINI_APPS}>
        <NavigationProbe />
      </AppNavigationProvider>
    </WindowStateProvider>,
  );
}

test("routed navigation pushes mini-app routes without creating windows", async () => {
  let pushedUrl: string | URL | null | undefined;
  const restorePushState = spyPushState((_data, url) => {
    pushedUrl = url;
  });
  const view = renderNavigationProbe("routed");

  fireEvent.click(view.getByRole("button", { name: "Open Contacts" }));

  try {
    await waitFor(() => {
      expect(pushedUrl).toBe("/app/contacts");
      expect(view.getByTestId("active-app").textContent).toBe("contacts");
      expect(view.getByTestId("window-count").textContent).toBe("0");
    });
  } finally {
    restorePushState();
  }
});

test("routed navigation tracks app-owned history availability", async () => {
  const pushedStates: unknown[] = [];
  const pushedUrls: Array<string | URL | null | undefined> = [];
  const replacedStates: unknown[] = [];
  const restorePushState = spyPushState((data, url) => {
    pushedStates.push(data);
    pushedUrls.push(url);
  });
  const restoreReplaceState = spyReplaceState((data) => {
    replacedStates.push(data);
  });
  const view = renderNavigationProbe("routed");

  try {
    expect(view.getByTestId("can-go-back").textContent).toBe("false");
    expect(view.getByTestId("can-go-forward").textContent).toBe("false");

    fireEvent.click(view.getByRole("button", { name: "Open Contacts" }));

    await waitFor(() => {
      expect(view.getByTestId("can-go-back").textContent).toBe("true");
      expect(view.getByTestId("can-go-forward").textContent).toBe("false");
    });
    expect(readAppNavigationHistoryState(replacedStates.at(-1))).toEqual({
      entries: 2,
      index: 0,
    });
    expect(pushedUrls.at(-1)).toBe("/app/contacts");
    expect(readAppNavigationHistoryState(pushedStates.at(-1))).toEqual({
      entries: 2,
      index: 1,
    });

    fireEvent.click(view.getByRole("button", { name: "Open Ada" }));

    await waitFor(() => {
      expect(view.getByTestId("active-path").textContent).toBe("contact/ada");
      expect(view.getByTestId("can-go-back").textContent).toBe("true");
      expect(view.getByTestId("can-go-forward").textContent).toBe("false");
    });
    expect(readAppNavigationHistoryState(replacedStates.at(-1))).toEqual({
      entries: 3,
      index: 1,
    });
    expect(pushedUrls.at(-1)).toBe("/app/contacts/contact/ada");
    expect(readAppNavigationHistoryState(pushedStates.at(-1))).toEqual({
      entries: 3,
      index: 2,
    });
  } finally {
    restorePushState();
    restoreReplaceState();
  }
});

test("routed replace navigation preserves the current history cursor", async () => {
  const pushedUrls: Array<string | URL | null | undefined> = [];
  const replacedStates: unknown[] = [];
  const replacedUrls: Array<string | URL | null | undefined> = [];
  const restorePushState = spyPushState((_data, url) => {
    pushedUrls.push(url);
  });
  const restoreReplaceState = spyReplaceState((data, url) => {
    replacedStates.push(data);
    replacedUrls.push(url);
  });
  const view = renderNavigationProbe("routed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Open Contacts" }));
    await waitFor(() => {
      expect(view.getByTestId("can-go-back").textContent).toBe("true");
    });

    fireEvent.click(view.getByRole("button", { name: "Replace Ada" }));

    await waitFor(() => {
      expect(view.getByTestId("active-path").textContent).toBe("contact/ada");
      expect(view.getByTestId("can-go-back").textContent).toBe("true");
      expect(view.getByTestId("can-go-forward").textContent).toBe("false");
    });
    expect(pushedUrls).toEqual(["/app/contacts"]);
    expect(replacedUrls.at(-1)).toBe("/app/contacts/contact/ada");
    expect(readAppNavigationHistoryState(replacedStates.at(-1))).toEqual({
      entries: 2,
      index: 1,
    });
  } finally {
    restorePushState();
    restoreReplaceState();
  }
});

test("routed popstate restores route and forward availability", async () => {
  const originalForward = window.history.forward;
  let forwardCallCount = 0;
  window.history.forward = function forwardSpy() {
    forwardCallCount += 1;
  };
  const view = renderNavigationProbe("routed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Open Contacts" }));
    fireEvent.click(view.getByRole("button", { name: "Open Ada" }));

    await waitFor(() => {
      expect(view.getByTestId("active-path").textContent).toBe("contact/ada");
    });

    const poppedState = createAppNavigationHistoryState(1, 3);
    act(() => {
      window.history.replaceState(poppedState, "", "/app/contacts");
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: poppedState }),
      );
    });

    await waitFor(() => {
      expect(view.getByTestId("active-path").textContent).toBe("");
      expect(view.getByTestId("can-go-back").textContent).toBe("true");
      expect(view.getByTestId("can-go-forward").textContent).toBe("true");
    });

    const forwardButton = view.getByRole("button", { name: "Go Forward" });
    fireEvent.click(forwardButton);
    fireEvent.click(forwardButton);
    expect(forwardCallCount).toBe(1);
    await waitFor(() => {
      expect(view.getByTestId("can-go-forward").textContent).toBe("false");
    });
  } finally {
    window.history.forward = originalForward;
  }
});

test("routed history actions are no-ops at history boundaries", () => {
  const originalBack = window.history.back;
  const originalForward = window.history.forward;
  let backCallCount = 0;
  let forwardCallCount = 0;
  window.history.back = function backSpy() {
    backCallCount += 1;
  };
  window.history.forward = function forwardSpy() {
    forwardCallCount += 1;
  };
  const view = renderNavigationProbe("routed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Go Back" }));
    fireEvent.click(view.getByRole("button", { name: "Go Forward" }));

    expect(backCallCount).toBe(0);
    expect(forwardCallCount).toBe(0);
  } finally {
    window.history.back = originalBack;
    window.history.forward = originalForward;
  }
});

test("app route parsing reads the mini-app segment from nested route paths", () => {
  expect(
    parseAppRoute("/app/explorer/documents/example", TEST_MINI_APPS),
  ).toEqual({ appId: "explorer", pathSegments: ["documents", "example"] });
});

test("routed navigation pushes mini-app subroutes", async () => {
  let pushedUrl: string | URL | null | undefined;
  const restorePushState = spyPushState((_data, url) => {
    pushedUrl = url;
  });
  const view = renderNavigationProbe("routed");

  fireEvent.click(view.getByRole("button", { name: "Open Ada" }));

  try {
    await waitFor(() => {
      expect(pushedUrl).toBe("/app/contacts/contact/ada");
      expect(view.getByTestId("active-app").textContent).toBe("contacts");
      expect(view.getByTestId("active-path").textContent).toBe("contact/ada");
      expect(view.getByTestId("contacts-path").textContent).toBe("contact/ada");
    });
  } finally {
    restorePushState();
  }
});

test("windowed navigation creates a mini-app window without changing route", () => {
  let pushedUrl: string | URL | null | undefined;
  const restorePushState = spyPushState((_data, url) => {
    pushedUrl = url;
  });
  const view = renderNavigationProbe("windowed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Open Contacts" }));

    expect(pushedUrl).toBeUndefined();
    expect(view.getByTestId("active-app").textContent).toBe("none");
    expect(view.getByTestId("window-count").textContent).toBe("1");
  } finally {
    restorePushState();
  }
});

test("windowed direct route navigation does not push browser history", () => {
  let pushedUrl: string | URL | null | undefined;
  const restorePushState = spyPushState((_data, url) => {
    pushedUrl = url;
  });
  const view = renderNavigationProbe("windowed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Open Ada" }));

    expect(pushedUrl).toBeUndefined();
    expect(view.getByTestId("active-app").textContent).toBe("none");
    expect(view.getByTestId("active-path").textContent).toBe("");
    expect(view.getByTestId("window-count").textContent).toBe("0");
  } finally {
    restorePushState();
  }
});

test("windowed mini-app opens with window-local route segments", async () => {
  let pushedUrl: string | URL | null | undefined;
  const restorePushState = spyPushState((_data, url) => {
    pushedUrl = url;
  });
  const view = renderNavigationProbe("windowed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Open Contacts at Ada" }));

    await waitFor(() => {
      expect(pushedUrl).toBeUndefined();
      expect(view.getByTestId("window-count").textContent).toBe("1");
      expect(view.getByTestId("contacts-window-path").textContent).toBe(
        "contact/ada",
      );
    });

    fireEvent.click(view.getByRole("button", { name: "Select Grace" }));

    await waitFor(() => {
      expect(view.getByTestId("contacts-window-path").textContent).toBe(
        "contact/grace",
      );
    });
  } finally {
    restorePushState();
  }
});

test("windowed mini-app reuse receives the next route segments", async () => {
  const view = renderNavigationProbe("windowed");

  fireEvent.click(view.getByRole("button", { name: "Open Contacts at Ada" }));

  await waitFor(() => {
    expect(view.getByTestId("contacts-window-path").textContent).toBe(
      "contact/ada",
    );
  });

  fireEvent.click(
    view.getByRole("button", { name: "Open Contacts at Hopper" }),
  );

  await waitFor(() => {
    expect(view.getByTestId("window-count").textContent).toBe("1");
    expect(view.getByTestId("contacts-window-path").textContent).toBe(
      "contact/hopper",
    );
  });
});
