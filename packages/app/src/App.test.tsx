import { afterEach, expect, test } from "bun:test";
import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import { render, waitFor } from "@testing-library/react";
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
