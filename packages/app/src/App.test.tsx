import { afterEach, expect, test } from "bun:test";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { cleanup, render } from "@testing-library/react";
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
