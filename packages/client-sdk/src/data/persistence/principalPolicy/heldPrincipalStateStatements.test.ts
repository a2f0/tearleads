import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createSuccessorPrincipalPolicyBundle } from "../../../../test/helpers/policyCacheFixtures";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { loadHeldPrincipalState } from "./heldPrincipalState";
import { savePrincipalPolicyBundle } from "./principalPolicyPersistence";

test("held states read an indexed predecessor or exact head with one bundle statement", async () => {
  const db = createNativeTestExecSql();
  const counted = countingExecSql(db.execSql);
  const { bundle, previousBundle } =
    await createSuccessorPrincipalPolicyBundle();
  try {
    await savePrincipalPolicyBundle(
      counted.execSql,
      bundle,
      "2026-01-01T00:00:00.000Z",
      "organization",
    );
    for (const state of [bundle.currentState, previousBundle.currentState]) {
      expect(
        await counted.count(async () => {
          expect(await loadHeldPrincipalState(counted.execSql, state)).toEqual(
            state,
          );
        }),
      ).toBe(2);
    }
    expect(
      await loadHeldPrincipalState(counted.execSql, {
        ...previousBundle.currentState,
        keyEpoch: 999,
      }),
    ).toBeNull();
  } finally {
    db.close();
  }
});
