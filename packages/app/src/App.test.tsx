import { expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { MockWorker } from "../test/helpers/mockWorker";
import "../test/helpers/wsServer";
import { App } from "./App";
import { createAppDatabaseWorker } from "./db/sqliteWorker";

test("renders App", async () => {
  const workers: MockWorker[] = [];

  const view = render(
    <App
      createWorker={() => {
        const appWorker = createAppDatabaseWorker(MockWorker);
        workers.push(appWorker.worker as MockWorker);
        return appWorker;
      }}
    />,
  );

  await waitFor(() => {
    expect(
      view.getAllByText(/sqlite worker: ready/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  view.unmount();
  for (const worker of workers) {
    expect(worker.terminated).toBe(true);
  }
});
