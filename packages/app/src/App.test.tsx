import { afterEach, expect, test } from "bun:test";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { MockWorker } from "../test/helpers/mockWorker";
import { App } from "./App";
import { AppHostConfig } from "./host/AppHostConfig";

afterEach(() => {
  cleanup();
});

test("renders App", async () => {
  const originalWebSocket = globalThis.WebSocket;

  class SilentWebSocket extends EventTarget {
    constructor(_url: string | URL) {
      super();
    }

    close() {}
  }

  try {
    Reflect.set(globalThis, "WebSocket", SilentWebSocket);

    const view = render(
      <App
        hostConfig={
          new AppHostConfig(
            "http://localhost:3001",
            "ws://localhost:3002",
            () =>
              createSQLiteRuntime({
                workerConstructor: MockWorker,
              }),
          )
        }
      />,
    );

    expect(
      view.getAllByText(/sqlite worker: idle/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      view.getAllByText(
        /Generate a key pair from the pane menu to boot this pane\./,
      ).length,
    ).toBeGreaterThanOrEqual(1);

    const firstMenuButton = view.getAllByText("Menu")[0];
    if (!firstMenuButton) {
      throw new Error("Expected a pane menu button.");
    }

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("routed App home can generate a pane key pair from shell chrome", async () => {
  const originalWebSocket = globalThis.WebSocket;

  class SilentWebSocket extends EventTarget {
    constructor(_url: string | URL) {
      super();
    }

    close() {}
  }

  try {
    Reflect.set(globalThis, "WebSocket", SilentWebSocket);

    const view = render(
      <App
        hostConfig={
          new AppHostConfig(
            "http://localhost:3001",
            "ws://localhost:3002",
            () =>
              createSQLiteRuntime({
                workerConstructor: MockWorker,
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            "routed",
          )
        }
      />,
    );

    // The redesigned routed shell renders the navigation/system actions
    // inline in the rail (tablet) or drawer (mobile) instead of behind a
    // "Pane" popover, so there is no "Pane" or "Menu" button.
    expect(view.queryByRole("button", { name: "Pane" })).toBeNull();
    expect(view.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(
      view.getByText(/Generate a key pair to boot this pane\./),
    ).toBeTruthy();
    expect(
      view.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    ).toBe("page");

    // System actions live directly in the rail — no popover to open first.
    expect(
      view.getByRole("button", { name: "Restore Key Package" }),
    ).toBeTruthy();
    const generateKeyPairButton = view.getAllByRole("button", {
      name: "Generate Key Pair",
    })[1];
    if (!generateKeyPairButton) {
      throw new Error("Expected routed rail generate action.");
    }
    fireEvent.click(generateKeyPairButton);

    await waitFor(() => {
      const statusText = view.container.textContent ?? "";
      expect(statusText).toMatch(/sqlite worker:\s*ready/);
      expect(statusText).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
    });

    fireEvent.click(view.getByRole("link", { name: "Contacts" }));

    // The mini-app sidebar mounts when expanded and unmounts when hidden
    // (conditional render), rather than toggling an inline display style.
    await waitFor(() => {
      expect(
        view
          .getByRole("link", { name: "Contacts" })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(view.getByRole("button", { name: "Hide Sidebar" })).toBeTruthy();
      const sidebar = view.container.querySelector<HTMLElement>(
        "#routed-pane-sidebar",
      );
      if (!sidebar) {
        throw new Error("Expected routed pane sidebar to be mounted.");
      }
      expect(within(sidebar).getByRole("button", { name: "You" })).toBeTruthy();
    });

    fireEvent.click(view.getByRole("button", { name: "Hide Sidebar" }));
    expect(view.container.querySelector("#routed-pane-sidebar")).toBeNull();
    expect(
      view
        .getByRole("button", { name: "Show Sidebar" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    fireEvent.click(view.getByRole("button", { name: "Show Sidebar" }));
    expect(view.container.querySelector("#routed-pane-sidebar")).toBeTruthy();

    const homeLink = view.getByRole("link", { name: "Home" });
    fireEvent.click(homeLink);

    await waitFor(() => {
      expect(
        view.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
      ).toBe("page");
      expect(view.queryByRole("button", { name: "Hide Sidebar" })).toBeNull();
    });

    // Destroy Key Pair is also inline in the rail now that a key pair exists.
    expect(view.getByRole("button", { name: "Destroy Key Pair" })).toBeTruthy();

    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
