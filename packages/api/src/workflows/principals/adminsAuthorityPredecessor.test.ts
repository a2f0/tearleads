import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  policyMember,
  signPolicyState,
} from "@tearleads/crypto/principal-policy-test-fixtures";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import { withBoundedPrincipalHistory } from "./principalHistoryExecution";
import { PrincipalHistoryPreparationRequired } from "./principalHistoryPreparationRequest";
import {
  PrincipalHistoryContinuation,
  runPrincipalHistoryTransaction,
} from "./principalHistoryTransaction";
import { storeVerifiedPrincipalPolicyInTransaction } from "./storeVerifiedPrincipalPolicy";

/** An Admins-shaped history whose strict authority prefix was never prepared. */
async function unpreparedAdminsSuccessor() {
  const admins = await principalHistoryPreparationFixture({
    versions: 3,
    currentArtifacts: true,
  });
  expect(
    (
      await preparePrincipalHistory(db, {
        head: admins.head,
        budget: principalHistoryPreparationBudget(),
      })
    ).complete,
  ).toBe(true);
  const projection = [policyMember(admins.signer, "admin")];
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: admins.principalKeyPair.secretKey,
      projection,
    });
  const successor = await signPolicyState({
    signer: admins.signer,
    principalId: admins.head.principalId,
    principalKeyPair: admins.principalKeyPair,
    members: stateMembers,
    memberEnvelopes,
    projection,
    version: 4,
    prevStateHash: admins.head.stateHash,
  });
  const store = (
    tx: Parameters<typeof storeVerifiedPrincipalPolicyInTransaction>[1],
  ) =>
    storeVerifiedPrincipalPolicyInTransaction(
      {
        state: successor.state,
        encryptedPayload: successor.payload,
        projection: [...successor.entry.projection],
        grants: [...successor.entry.grants],
        memberEnvelopes: [...successor.memberEnvelopes],
      },
      tx,
      {
        identityTrustDomain: admins.signer.identityTrustDomain,
        reservedAdmins: true,
      },
    );
  return { admins, store };
}

test("an Admins successor prepares its committed predecessor's authority first", async () => {
  const { admins, store } = await unpreparedAdminsSuccessor();
  const required = await withBoundedPrincipalHistory(() =>
    db.transaction(store),
  ).catch((error: unknown) => error);
  expect(required).toBeInstanceOf(PrincipalHistoryPreparationRequired);
  if (!(required instanceof PrincipalHistoryPreparationRequired)) return;
  // The committed head, not the rolled-back successor.
  expect(required.request.kind).toBe("authority");
  expect(required.request.head.version).toBe(admins.head.version);
  expect(required.request.head.stateHash).toBe(admins.head.stateHash);
});

test("a competing preparation of the Admins predecessor lets the successor retry", async () => {
  const { admins, store } = await unpreparedAdminsSuccessor();
  const required = await withBoundedPrincipalHistory(() =>
    db.transaction(store),
  ).catch((error: unknown) => error);
  expect(required).toBeInstanceOf(PrincipalHistoryPreparationRequired);
  // Another request completes the same authority prefix after this rollback,
  // before this request's queued preparation starts.
  expect(
    (
      await preparePrincipalHistory(db, {
        head: admins.head,
        kind: "authority",
        budget: principalHistoryPreparationBudget(),
      })
    ).complete,
  ).toBe(true);
  let delayed = true;
  const attempt = () =>
    runPrincipalHistoryTransaction(db, async (tx) => {
      if (delayed) {
        delayed = false;
        throw required;
      }
      return store(tx);
    });
  await expect(attempt()).rejects.toBeInstanceOf(PrincipalHistoryContinuation);
  expect((await attempt()).version).toBe(4);
  expect(
    (await getCurrentPrincipalState("group", admins.head.principalId, db))
      ?.version,
  ).toBe(4);
});
