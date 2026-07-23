import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { WindowStateProvider } from "../../../components/window/WindowStateProvider";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import type { MiniAppDefinition, MiniAppId } from "../../types";
import { useContactsRouteState } from "./useContactsRouteState";

function EmptyMiniApp() {
  return null;
}

const TEST_MINI_APPS = {
  "backup-restore": {
    createComponent: () => EmptyMiniApp,
    title: "Backup / Restore",
  },
  contacts: { createComponent: () => EmptyMiniApp, title: "Contacts" },
  explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  "identity-manager": {
    createComponent: () => EmptyMiniApp,
    title: "Identity Manager",
  },
  notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
  "org-manager": { createComponent: () => EmptyMiniApp, title: "Org Manager" },
  "system-monitor": {
    createComponent: () => EmptyMiniApp,
    title: "System Monitor",
  },
} satisfies Readonly<Record<MiniAppId, MiniAppDefinition>>;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function ContactsRouteStateHarness() {
  const routeState = useContactsRouteState(false);
  // Stands in for a create/import whose storage write is still in flight: the
  // callback is captured on the draft route and only invoked once the user has
  // routed elsewhere.
  const inFlightSave = useRef<((contactId: string) => void) | null>(null);

  return (
    <>
      <button type="button" onClick={routeState.openNewContactRoute}>
        New Contact
      </button>
      <button
        type="button"
        onClick={() => {
          inFlightSave.current = routeState.selectCreatedContactRoute;
        }}
      >
        Begin Save
      </button>
      <button type="button" onClick={() => inFlightSave.current?.("ada")}>
        Finish Save
      </button>
      <button type="button" onClick={routeState.openImportContactRoute}>
        Import Contact
      </button>
      <button
        type="button"
        onClick={() => routeState.selectCreatedContactRoute("ada")}
      >
        Save Draft
      </button>
      <button
        type="button"
        onClick={() => routeState.selectContactRoute("hopper")}
      >
        Select Hopper
      </button>
      <div data-testid="route">{routeState.route}</div>
      <div data-testid="selected-contact-id">
        {routeState.selectedContactId ?? ""}
      </div>
    </>
  );
}

function renderContactsRouteStateHarness(path = "/app/contacts") {
  const happyDomWindow = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDomWindow.happyDOM.setURL(`http://localhost${path}`);
  window.history.replaceState(null, "", path);
  return render(
    <WindowStateProvider>
      <AppNavigationProvider mode="routed" miniApps={TEST_MINI_APPS}>
        <ContactsRouteStateHarness />
      </AppNavigationProvider>
    </WindowStateProvider>,
  );
}

function spyHistory() {
  const pushedUrls: Array<string | URL | null | undefined> = [];
  const replacedUrls: Array<string | URL | null | undefined> = [];
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  window.history.pushState = function pushStateSpy(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    pushedUrls.push(url);
    return originalPushState.call(window.history, data, unused, url);
  };
  window.history.replaceState = function replaceStateSpy(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    if (url !== undefined) {
      replacedUrls.push(url);
    }
    return originalReplaceState.call(window.history, data, unused, url);
  };

  return {
    pushedUrls,
    replacedUrls,
    restore: () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    },
  };
}

test("saving a new contact replaces the blank draft route", async () => {
  const view = renderContactsRouteStateHarness();
  const history = spyHistory();

  try {
    fireEvent.click(view.getByRole("button", { name: "New Contact" }));
    await waitFor(() => {
      expect(view.getByTestId("route").textContent).toBe("new-contact");
      expect(window.location.pathname).toBe("/app/contacts/new");
    });

    fireEvent.click(view.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(view.getByTestId("route").textContent).toBe("selection");
      expect(view.getByTestId("selected-contact-id").textContent).toBe("ada");
    });
    // The draft form was swapped out, not stacked on: only opening it pushed.
    expect(history.pushedUrls).toEqual(["/app/contacts/new"]);
    expect(history.replacedUrls.at(-1)).toBe("/app/contacts/contact/ada");
  } finally {
    history.restore();
  }
});

test("importing a contact replaces the blank import route", async () => {
  const view = renderContactsRouteStateHarness();
  const history = spyHistory();

  try {
    fireEvent.click(view.getByRole("button", { name: "Import Contact" }));
    await waitFor(() => {
      expect(view.getByTestId("route").textContent).toBe("import-contact");
    });

    fireEvent.click(view.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(view.getByTestId("selected-contact-id").textContent).toBe("ada");
    });
    expect(history.pushedUrls).toEqual(["/app/contacts/import"]);
    expect(history.replacedUrls.at(-1)).toBe("/app/contacts/contact/ada");
  } finally {
    history.restore();
  }
});

test("a contact created from the selection route still pushes", async () => {
  const view = renderContactsRouteStateHarness();
  const history = spyHistory();

  try {
    // Message-driven imports (org-manager's "Import Into Contacts") land here
    // with no transient draft route to prune.
    fireEvent.click(view.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(view.getByTestId("selected-contact-id").textContent).toBe("ada");
    });
    expect(history.pushedUrls).toEqual(["/app/contacts/contact/ada"]);
  } finally {
    history.restore();
  }
});

test("a save that lands after the draft is abandoned does not replace", async () => {
  const view = renderContactsRouteStateHarness();
  const history = spyHistory();

  try {
    fireEvent.click(view.getByRole("button", { name: "New Contact" }));
    await waitFor(() => {
      expect(view.getByTestId("route").textContent).toBe("new-contact");
    });
    fireEvent.click(view.getByRole("button", { name: "Begin Save" }));

    // The user leaves the draft form while the write is still in flight.
    fireEvent.click(view.getByRole("button", { name: "Select Hopper" }));
    await waitFor(() => {
      expect(view.getByTestId("selected-contact-id").textContent).toBe(
        "hopper",
      );
    });

    fireEvent.click(view.getByRole("button", { name: "Finish Save" }));

    await waitFor(() => {
      expect(view.getByTestId("selected-contact-id").textContent).toBe("ada");
    });
    // The draft entry is no longer current, so the created contact must not
    // overwrite the entry the user moved to.
    expect(history.pushedUrls).toEqual([
      "/app/contacts/new",
      "/app/contacts/contact/hopper",
      "/app/contacts/contact/ada",
    ]);
  } finally {
    history.restore();
  }
});

test("selecting an existing contact from the list pushes", async () => {
  const view = renderContactsRouteStateHarness();
  const history = spyHistory();

  try {
    fireEvent.click(view.getByRole("button", { name: "Select Hopper" }));

    await waitFor(() => {
      expect(view.getByTestId("selected-contact-id").textContent).toBe(
        "hopper",
      );
    });
    expect(history.pushedUrls).toEqual(["/app/contacts/contact/hopper"]);
  } finally {
    history.restore();
  }
});
