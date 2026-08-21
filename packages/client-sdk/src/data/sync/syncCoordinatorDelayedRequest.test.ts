import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

test("a delayed document request stays pending without blocking structural work", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const calls: string[] = [];
  const structural = coordinator.registerLane("structural", {
    phase: "structural",
    run: async () => {
      calls.push("structural");
    },
  });
  const document = coordinator.registerLane("document", {
    phase: "document",
    run: async () => {
      calls.push("document");
    },
  });

  document.requestSyncAfter(100);
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 5,
      timeoutMs: 20,
    }),
  ).toBe(false);

  structural.requestSync();
  await waitFor(() => calls.length === 1, "Expected structural work first");
  expect(calls).toEqual(["structural"]);
  await waitFor(
    () => calls.length === 2,
    "Expected delayed document work",
    500,
  );
  expect(calls).toEqual(["structural", "document"]);
});
