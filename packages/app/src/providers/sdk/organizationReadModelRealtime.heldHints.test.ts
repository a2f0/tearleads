import { expect, test } from "bun:test";
import {
  ensureOrganizationReadModelReconciliation,
  handleOrganizationReadModelHint,
  releaseDeferredOrganizationReadModelHint,
  subscribeOrganizationReadModelRealtime,
  trackOrganizationReadModelCatchUp,
} from "./organizationReadModelRealtime";
import {
  createRuntimeHarness,
  ORGANIZATION_A,
} from "./test/organizationReadModelRealtimeHarness";

async function mutatingConsumer(
  loadDirectoryAndGroups?: () => Promise<unknown>,
) {
  const runtime = createRuntimeHarness(
    loadDirectoryAndGroups ? { loadDirectoryAndGroups } : undefined,
  );
  const consumer = { mutating: false };
  subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {},
    { isMutationActive: () => consumer.mutating },
  );
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  consumer.mutating = true;
  return { consumer, runtime };
}

function postMutationPass(
  runtime: ReturnType<typeof createRuntimeHarness>,
): Promise<unknown> {
  return trackOrganizationReadModelCatchUp(runtime.tearleads, () =>
    runtime.tearleads.organizations.loadDirectoryAndGroupsAfterMutation(),
  );
}

/** Release, then let any scheduled pass run without starting one itself. */
async function release(
  runtime: ReturnType<typeof createRuntimeHarness>,
): Promise<void> {
  releaseDeferredOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a post-mutation pass started after a held hint absorbs its release", async () => {
  const { consumer, runtime } = await mutatingConsumer();
  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, true);
  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(1);

  // The hint was published after its change committed and arrived before this
  // pass sent its request, so the pass observed the change whichever session
  // made it.
  await postMutationPass(runtime);
  expect(runtime.reconcileCalls).toBe(2);

  consumer.mutating = false;
  await release(runtime);
  expect(runtime.reconcileCalls).toBe(2);
});

test("a hint held after the post-mutation pass started is still reconciled", async () => {
  let finishPass: (value: unknown) => void = () => {};
  let holdNextPass = false;
  const { consumer, runtime } = await mutatingConsumer(() => {
    if (!holdNextPass) return Promise.resolve({});
    return new Promise((resolve) => {
      finishPass = resolve;
    });
  });
  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, true);
  holdNextPass = true;
  const pass = postMutationPass(runtime);
  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, true);
  holdNextPass = false;
  finishPass({});
  await pass;
  expect(runtime.reconcileCalls).toBe(2);

  consumer.mutating = false;
  await release(runtime);
  expect(runtime.reconcileCalls).toBe(3);
});

test("a post-mutation pass that declines covers no held hint", async () => {
  let declineNextPass = false;
  const { consumer, runtime } = await mutatingConsumer(() =>
    Promise.resolve(declineNextPass ? undefined : {}),
  );
  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, true);
  declineNextPass = true;
  await postMutationPass(runtime);
  declineNextPass = false;
  expect(runtime.reconcileCalls).toBe(2);

  consumer.mutating = false;
  await release(runtime);
  expect(runtime.reconcileCalls).toBe(3);
});
