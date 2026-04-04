import { afterEach, expect, test } from "bun:test";
import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MockWorker } from "../test/helpers/mockWorker";
import { resetMockServer, wsUrl } from "../test/helpers/mswServer";
import { App } from "./App";
import { AppHostConfig } from "./host/AppHostConfig";

afterEach(() => resetMockServer());

test("renders App", async () => {
  const mockWorkers: MockWorker[] = [];

  const view = render(
    <App
      hostConfig={
        new AppHostConfig("http://localhost:3001", wsUrl, () => {
          const worker = new MockWorker();
          mockWorkers.push(worker);
          return {
            id: crypto.randomUUID(),
            client: createDatabaseWorkerClient(worker),
            worker,
          };
        })
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

  fireEvent.click(firstMenuButton);
  fireEvent.click(view.getByText("Generate Key Pair"));

  await waitFor(() => {
    expect(
      view.getAllByText(/sqlite worker: ready/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  view.unmount();
  for (const worker of mockWorkers) {
    expect(worker.terminated).toBe(true);
  }
});
