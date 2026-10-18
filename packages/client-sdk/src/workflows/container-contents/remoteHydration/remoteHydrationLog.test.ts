import { expect, test } from "bun:test";
import { describeRemoteContainerHydration } from "./remoteHydrationLog";

test("reports a device-first re-pull of already-local containers as reconciled", () => {
  // The fresh-bootstrap case: the system containers were recreated locally
  // before the server re-pull, so nothing was newly downloaded.
  expect(
    describeRemoteContainerHydration({ changedCount: 2, insertedCount: 0 }),
  ).toBe(
    "Container contents: reconciled 2 already-local container(s) with the server",
  );
});

test("reports genuinely new containers as hydrated from the server", () => {
  expect(
    describeRemoteContainerHydration({ changedCount: 3, insertedCount: 3 }),
  ).toBe(
    "Container contents: hydrated 3 new remote container(s) from the server",
  );
});

test("reports a mixed pass with both new and already-local containers", () => {
  expect(
    describeRemoteContainerHydration({ changedCount: 3, insertedCount: 1 }),
  ).toBe(
    "Container contents: hydrated 1 new remote container(s) from the server (2 already local)",
  );
});
