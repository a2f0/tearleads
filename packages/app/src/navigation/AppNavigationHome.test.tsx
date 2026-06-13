import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { WindowStateProvider } from "../components/window/WindowStateProvider";
import type { MiniAppDefinition, MiniAppId } from "../mini-apps/types";
import {
  AppNavigationProvider,
  useAppNavigationActions,
  useAppNavigationState,
} from "./AppNavigationProvider";

function EmptyMiniApp() {
  return null;
}

const TEST_MINI_APPS: Readonly<Record<MiniAppId, MiniAppDefinition>> = {
  contacts: { createComponent: () => EmptyMiniApp, title: "Contacts" },
  explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  "identity-manager": {
    createComponent: () => EmptyMiniApp,
    title: "Identity Manager",
  },
  notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
  "org-manager": { createComponent: () => EmptyMiniApp, title: "Org Manager" },
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function HomeNavigationProbe() {
  const { getHomeHref, navigateHome, openMiniApp } = useAppNavigationActions();
  const {
    route: { appId, pathSegments },
  } = useAppNavigationState();

  return (
    <>
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
      <button type="button" onClick={() => navigateHome()}>
        Open Home
      </button>
      <div data-testid="active-app">{appId ?? "none"}</div>
      <div data-testid="active-path">{pathSegments.join("/")}</div>
      <div data-testid="home-href">{getHomeHref()}</div>
    </>
  );
}

function spyPushState(onPush: (url: string | URL | null | undefined) => void) {
  const originalPushState = window.history.pushState;
  window.history.pushState = function pushStateSpy(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    onPush(url);
    return originalPushState.call(window.history, data, unused, url);
  };
  return () => {
    window.history.pushState = originalPushState;
  };
}

function renderHomeNavigationProbe(mode: "routed" | "windowed") {
  return render(
    <WindowStateProvider>
      <AppNavigationProvider mode={mode} miniApps={TEST_MINI_APPS}>
        <HomeNavigationProbe />
      </AppNavigationProvider>
    </WindowStateProvider>,
  );
}

test("routed navigation can return to home through app history", async () => {
  const pushedUrls: Array<string | URL | null | undefined> = [];
  const restorePushState = spyPushState((url) => pushedUrls.push(url));
  const view = renderHomeNavigationProbe("routed");

  try {
    expect(view.getByTestId("home-href").textContent).toBe("/");
    fireEvent.click(view.getByRole("button", { name: "Open Contacts at Ada" }));

    await waitFor(() => {
      expect(view.getByTestId("active-app").textContent).toBe("contacts");
      expect(view.getByTestId("active-path").textContent).toBe("contact/ada");
    });

    fireEvent.click(view.getByRole("button", { name: "Open Home" }));

    await waitFor(() => {
      expect(view.getByTestId("active-app").textContent).toBe("none");
      expect(view.getByTestId("active-path").textContent).toBe("");
    });
    expect(pushedUrls).toEqual(["/app/contacts/contact/ada", "/"]);
  } finally {
    restorePushState();
  }
});

test("windowed home navigation does not touch browser history", () => {
  const pushedUrls: Array<string | URL | null | undefined> = [];
  const restorePushState = spyPushState((url) => pushedUrls.push(url));
  const view = renderHomeNavigationProbe("windowed");

  try {
    fireEvent.click(view.getByRole("button", { name: "Open Home" }));

    expect(view.getByTestId("active-app").textContent).toBe("none");
    expect(view.getByTestId("active-path").textContent).toBe("");
    expect(pushedUrls).toEqual([]);
  } finally {
    restorePushState();
  }
});
