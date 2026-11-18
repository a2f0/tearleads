import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { principalHistoryPreparationBudget } from "./preparePrincipalHistory";
import {
  principalHistoryExecutionBudget,
  withBoundedPrincipalHistory,
  withPreparedPrincipalHistoryOnly,
  withPrincipalHistorySuccessorStep,
} from "./principalHistoryExecution";

const head: ReferencedPrincipalHead = {
  keyEpoch: 1,
  keyFingerprint: "fingerprint",
  principalId: "group-1",
  principalType: "group",
  stateHash: "state-hash",
  version: 2,
};

test("optional work outside a bounded workflow reads only prepared history", async () => {
  expect(principalHistoryExecutionBudget(head)).toMatchObject({
    acceptedEntries: 0,
    remainingEntries: principalHistoryPreparationBudget().remainingEntries,
  });
  await withPreparedPrincipalHistoryOnly(async () => {
    expect(principalHistoryExecutionBudget(head)).toMatchObject({
      acceptedEntries: 1,
      remainingEntries: 0,
    });
  });
});

test("optional work inside a bounded workflow keeps its successor allowance", async () => {
  await withBoundedPrincipalHistory(() =>
    withPrincipalHistorySuccessorStep(head, () =>
      withPreparedPrincipalHistoryOnly(async () => {
        expect(principalHistoryExecutionBudget(head).remainingEntries).toBe(1);
      }),
    ),
  );
});
