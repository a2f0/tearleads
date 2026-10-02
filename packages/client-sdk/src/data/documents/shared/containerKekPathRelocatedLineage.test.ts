import { expect, test } from "bun:test";
import { createParentProjectionUserKeyResolver } from "../../../../test/helpers/containerFixtures";
import {
  relocatedChildHistory,
  servingForgedKeyring,
} from "../../../../test/helpers/relocatedLineage";
import { unwrapContainerKekPathWithHistoryFailures } from "./containerKekPath";

// The default read path builds its own verified-manifest map, so these drive
// it end to end over history a server relocated under the parent's KEK
// (#2365 finding 32).
async function readRelocated(serve: typeof servingForgedKeyring | null = null) {
  const scenario = await relocatedChildHistory();
  const projection = serve ? await serve(scenario) : scenario.projection;
  const read = await unwrapContainerKekPathWithHistoryFailures({
    execSql: scenario.database.execSql,
    projection,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(
      scenario.parent,
    ),
    secretKey: scenario.parent.secretKey,
  });
  return { read, scenario };
}

test("the default read path opens honest history served under another KEK", async () => {
  const { read, scenario } = await readRelocated();
  expect(read.keksByEpochId.get(scenario.epoch1Id)).toEqual(
    scenario.child.containerKey,
  );
  expect(
    read.keksByEpochId.get(scenario.epoch2Kek.containerKeyEpochId),
  ).toEqual(scenario.epoch2Key);
  expect(read.predecessorFailuresByEpochId.size).toBe(0);
  expect(read.unattributedPredecessorFailuresByContainerId.size).toBe(0);
});

test("the default read path keeps the current KEK when a forged keyring is served", async () => {
  // An unsigned forged keyring stops at the keyring commitment before the
  // lineage check; either refusal is a history failure, never a lost KEK.
  const { read, scenario } = await readRelocated(servingForgedKeyring);
  expect(
    read.keksByEpochId.get(scenario.epoch2Kek.containerKeyEpochId),
  ).toEqual(scenario.epoch2Key);
  expect(read.keksByEpochId.has(scenario.epoch1Id)).toBe(false);
  expect(
    read.predecessorFailuresByEpochId.size +
      read.unattributedPredecessorFailuresByContainerId.size,
  ).toBeGreaterThan(0);
});
