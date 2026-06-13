import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

function EmptyMiniApp() {
  return null;
}

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
  contacts: {
    createComponent: () => ContactsRouteProbe,
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
    createComponent: () => EmptyMiniApp,
    title: "Org Manager",
  },
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function NavigationProbe() {
  const { navigateMiniAppRoute, openMiniApp } = useAppNavigationActions();
  const {
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
      <div data-testid="active-app">{appId ?? "none"}</div>
      <div data-testid="active-path">{pathSegments.join("/")}</div>
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
  const originalPushState = window.history.pushState;
  let pushedUrl: string | URL | null | undefined;
  window.history.pushState = function pushStateSpy(
    _data: unknown,
    _unused: string,
    url?: string | URL | null,
  ) {
    pushedUrl = url;
  };
  const view = renderNavigationProbe("routed");

  fireEvent.click(view.getByRole("button", { name: "Open Contacts" }));

  try {
    await waitFor(() => {
      expect(pushedUrl).toBe("/app/contacts");
      expect(view.getByTestId("active-app").textContent).toBe("contacts");
      expect(view.getByTestId("window-count").textContent).toBe("0");
    });
  } finally {
    window.history.pushState = originalPushState;
  }
});

test("app route parsing reads the mini-app segment from nested route paths", () => {
  expect(
    parseAppRoute("/app/explorer/documents/example", TEST_MINI_APPS),
  ).toEqual({ appId: "explorer", pathSegments: ["documents", "example"] });
});

test("routed navigation pushes mini-app subroutes", async () => {
  const originalPushState = window.history.pushState;
  let pushedUrl: string | URL | null | undefined;
  window.history.pushState = function pushStateSpy(
    _data: unknown,
    _unused: string,
    url?: string | URL | null,
  ) {
    pushedUrl = url;
  };
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
    window.history.pushState = originalPushState;
  }
});

test("windowed navigation creates a mini-app window without changing route", () => {
  const originalPushState = window.history.pushState;
  let pushedUrl: string | URL | null | undefined;
  window.history.pushState = function pushStateSpy(
    _data: unknown,
    _unused: string,
    url?: string | URL | null,
  ) {
    pushedUrl = url;
  };
  const view = renderNavigationProbe("windowed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Open Contacts" }));

    expect(pushedUrl).toBeUndefined();
    expect(view.getByTestId("active-app").textContent).toBe("none");
    expect(view.getByTestId("window-count").textContent).toBe("1");
  } finally {
    window.history.pushState = originalPushState;
  }
});

test("windowed direct route navigation does not push browser history", () => {
  const originalPushState = window.history.pushState;
  let pushedUrl: string | URL | null | undefined;
  window.history.pushState = function pushStateSpy(
    _data: unknown,
    _unused: string,
    url?: string | URL | null,
  ) {
    pushedUrl = url;
  };
  const view = renderNavigationProbe("windowed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Open Ada" }));

    expect(pushedUrl).toBeUndefined();
    expect(view.getByTestId("active-app").textContent).toBe("none");
    expect(view.getByTestId("active-path").textContent).toBe("");
    expect(view.getByTestId("window-count").textContent).toBe("0");
  } finally {
    window.history.pushState = originalPushState;
  }
});

test("windowed mini-app opens with window-local route segments", async () => {
  const originalPushState = window.history.pushState;
  let pushedUrl: string | URL | null | undefined;
  window.history.pushState = function pushStateSpy(
    _data: unknown,
    _unused: string,
    url?: string | URL | null,
  ) {
    pushedUrl = url;
  };
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
    window.history.pushState = originalPushState;
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
