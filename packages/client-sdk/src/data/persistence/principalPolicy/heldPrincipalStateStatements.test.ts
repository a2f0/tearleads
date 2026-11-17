import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createSuccessorPrincipalPolicyBundle } from "../../../../test/helpers/principalPolicyBundles";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { PrincipalPolicyBundleRepository } from "./principalPolicyBundleRepository";

test("held states read an indexed predecessor or exact head with one bundle statement", async () => {
  const db = createNativeTestExecSql();
  const counted = countingExecSql(db.execSql);
  const { bundle, previousBundle } =
    await createSuccessorPrincipalPolicyBundle();
  try {
    await new PrincipalPolicyBundleRepository(
      counted.execSql,
    ).savePrincipalPolicyBundle(bundle, "organization");
    for (const state of [bundle.currentState, previousBundle.currentState]) {
      expect(
        await counted.count(async () => {
          expect(
            await new PrincipalPolicyBundleRepository(
              counted.execSql,
            ).loadHeldPrincipalState(state),
          ).toEqual(state);
        }),
      ).toBe(2);
    }
    expect(
      await new PrincipalPolicyBundleRepository(
        counted.execSql,
      ).loadHeldPrincipalState({
        ...previousBundle.currentState,
        keyEpoch: 999,
      }),
    ).toBeNull();
  } finally {
    db.close();
  }
});
