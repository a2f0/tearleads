import { expect, test } from "bun:test";
import { createCapacitorSQLiteRuntime } from "./capacitorSQLiteRuntime";

class RecordingWorker extends EventTarget {
  static readonly scriptUrls: Array<string | URL> = [];

  constructor(scriptUrl: string | URL) {
    super();
    RecordingWorker.scriptUrls.push(scriptUrl);
  }

  postMessage() {}

  terminate() {}
}

// A worker can be created after the user navigates, when the reused worker is
// retired (for example on /app/identity-manager/ while provisioning another
// identity), so its script must resolve to the bundled worker from any route.
test("the SQLite worker loads the bundled script from nested routes", () => {
  const runtime = createCapacitorSQLiteRuntime(
    RecordingWorker as unknown as typeof globalThis.Worker,
  );
  runtime.terminateNow();

  const [scriptUrl] = RecordingWorker.scriptUrls;
  expect(RecordingWorker.scriptUrls).toHaveLength(1);
  expect(
    new URL(String(scriptUrl), "https://localhost/app/identity-manager/").href,
  ).toBe("https://localhost/worker.js");
  expect(
    new URL(String(scriptUrl), "capacitor://localhost/app/identity-manager/")
      .href,
  ).toBe("capacitor://localhost/worker.js");
});
