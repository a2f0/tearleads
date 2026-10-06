import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { signPolicyState } from "@tearleads/crypto/principal-policy-test-fixtures";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import {
  PrincipalHistoryContinuation,
  runPrincipalHistoryTransaction,
} from "./principalHistoryTransaction";
import { storeVerifiedPrincipalPolicyInTransaction } from "./storeVerifiedPrincipalPolicy";

test("a real successor and its authority cannot strand unrelated cold progress", async () => {
  const authority = await principalHistoryPreparationFixture({
    versions: 3,
    currentArtifacts: true,
  });
  const dependent = await principalHistoryPreparationFixture({
    versions: 1,
    currentArtifacts: true,
    signer: authority.signer,
    externalAuthority: { ...authority.head, principalType: "group" },
  });
  const cold = await principalHistoryPreparationFixture({
    versions: 32,
    currentArtifacts: true,
  });
  for (const kind of ["policy", "authority"] as const)
    expect(
      (
        await preparePrincipalHistory(db, {
          head: authority.head,
          kind,
          budget: principalHistoryPreparationBudget(),
        })
      ).complete,
    ).toBe(true);
  expect(
    (
      await preparePrincipalHistory(db, {
        head: dependent.head,
        budget: principalHistoryPreparationBudget(),
      })
    ).complete,
  ).toBe(true);
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: authority.principalKeyPair.secretKey,
      projection: [{ userId: authority.signer.userId, role: "admin" }],
    });
  const successor = await signPolicyState({
    signer: authority.signer,
    principalId: authority.head.principalId,
    principalKeyPair: authority.principalKeyPair,
    members: stateMembers,
    memberEnvelopes,
    version: 4,
    prevStateHash: authority.head.stateHash,
  });
  let completed = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await runPrincipalHistoryTransaction(db, async (tx) => {
        const coldState = await getCurrentPrincipalState(
          "group",
          cold.head.principalId,
          tx,
        );
        const dependentState = await getCurrentPrincipalState(
          "group",
          dependent.head.principalId,
          tx,
        );
        if (!coldState || !dependentState)
          throw new Error("Missing fixture state");
        await getVerifiedPrincipalPolicyForStateWithExecutor(tx, coldState);
        await storeVerifiedPrincipalPolicyInTransaction(
          {
            state: successor.state,
            encryptedPayload: successor.payload,
            projection: [...successor.entry.projection],
            grants: [...successor.entry.grants],
            memberEnvelopes: [...successor.memberEnvelopes],
          },
          tx,
        );
        await getVerifiedPrincipalPolicyForStateWithExecutor(
          tx,
          dependentState,
        );
      });
      completed = true;
      break;
    } catch (error) {
      if (!(error instanceof PrincipalHistoryContinuation)) throw error;
      expect(
        (
          await getCurrentPrincipalState(
            "group",
            authority.head.principalId,
            db,
          )
        )?.version,
      ).toBe(3);
    }
  }
  expect(completed).toBe(true);
  expect(
    (await getCurrentPrincipalState("group", authority.head.principalId, db))
      ?.version,
  ).toBe(4);
}, 30_000);
