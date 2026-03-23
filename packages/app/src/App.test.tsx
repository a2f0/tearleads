import { expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { MockWorker } from "../test/helpers/mockWorker";
import { App } from "./App";
import { createAppDatabaseWorker } from "./db/sqliteWorker";

test("renders App", async () => {
  let worker: MockWorker | undefined;

  const view = render(
    <App
      createWorker={() => {
        const appWorker = createAppDatabaseWorker(MockWorker);
        worker = appWorker.worker as MockWorker;
        return appWorker;
      }}
    />,
  );

  await waitFor(() => {
    expect(view.getByText(/Nav — worker: ready/)).toBeDefined();
  });

  view.unmount();
  expect(worker?.terminated).toBe(true);
});
