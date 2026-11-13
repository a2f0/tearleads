import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  principalMemberEnvelopes,
  principalStatePayloads,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { readPrincipalHistoryPage } from "../../access/read/principalHistoryProgress";
import { listPrincipalMemberEnvelopesForState } from "../../access/read/principalMemberEnvelopes";
import {
  getPrincipalPolicyArtifactsForState,
  type PrincipalPolicyArtifactRead,
} from "../../access/read/principalPolicyArtifacts";
import {
  getCurrentPrincipalState,
  getPrincipalStatePayloadForState,
} from "../../access/read/principalStateStore";
import { getVerifiedPrincipalHistory } from "./getVerifiedPrincipalHistory";
import { buildPrincipalPolicyCurrentForStateWithExecutor } from "./principalPolicyBundleRecords";

for (const memberCount of [0, 2, 64]) {
  test(`policy artifact batch preserves pinned payload and ${memberCount} ordered envelopes in one statement`, async () => {
    const { head, entries } = await principalHistoryPreparationFixture({
      versions: 2,
      currentArtifacts: true,
      initiallyOrdinaryMember: true,
    });
    const current = entries[1];
    const previous = entries[0];
    const envelope = current?.memberEnvelopes[0];
    if (!current || !previous || !envelope)
      throw new Error("Missing artifact fixture");
    await db.insert(principalStatePayloads).values(previous.payload);
    await db.insert(principalStatePayloads).values({
      ...current.payload,
      principalType: "organization",
      ciphertext: `${current.payload.ciphertext}-other-type`,
    });
    await db
      .delete(principalMemberEnvelopes)
      .where(eq(principalMemberEnvelopes.principalId, head.principalId));
    const envelopes = Array.from({ length: memberCount }, () => ({
      ...envelope,
      userId: crypto.randomUUID(),
      principalType: head.principalType,
      principalId: head.principalId,
      stateHash: head.stateHash,
      epoch: head.keyEpoch,
    }));
    // Old-state and other-type rows must not enter the selected bundle.
    await db.insert(principalMemberEnvelopes).values([
      ...envelopes,
      {
        ...envelope,
        principalType: head.principalType,
        principalId: head.principalId,
        stateHash: previous.state.stateHash,
        epoch: previous.state.keyEpoch,
      },
      {
        ...envelope,
        principalType: "organization",
        principalId: head.principalId,
        stateHash: head.stateHash,
        epoch: head.keyEpoch,
      },
    ]);
    const expectedPayload = await getPrincipalStatePayloadForState(
      "group",
      head.principalId,
      head.stateHash,
      db,
    );
    const expectedEnvelopes = await listPrincipalMemberEnvelopesForState(
      "group",
      head.principalId,
      head.stateHash,
      db,
    );
    const counter = { statements: 0 };
    const actual = await withDatabaseStatementCounter(counter, () =>
      getPrincipalPolicyArtifactsForState(
        "group",
        head.principalId,
        head.stateHash,
        db,
      ),
    );
    expect(counter.statements).toBe(1);
    expect(actual.payload).toEqual(expectedPayload);
    expect(actual.payload?.createdAt).toBeInstanceOf(Date);
    expect(actual.memberEnvelopes).toEqual(
      expectedEnvelopes.map(
        ({ userId, memberKeyFingerprint, kemCipherText, wrappedKey }) => ({
          userId,
          memberKeyFingerprint,
          kemCipherText,
          wrappedKey,
        }),
      ),
    );
    expect(actual.memberEnvelopes).toHaveLength(memberCount);
    const artifactRead: PrincipalPolicyArtifactRead = {
      stateHash: head.stateHash,
    };
    const combinedCounter = { statements: 0 };
    const combined = await withDatabaseStatementCounter(combinedCounter, () =>
      readPrincipalHistoryPage(
        db,
        {
          principalType: head.principalType,
          principalId: head.principalId,
          afterVersion: head.version - 1,
          throughVersion: head.version,
        },
        artifactRead,
      ),
    );
    expect(combinedCounter.statements).toBe(1);
    expect(combined[0]?.state.stateHash).toBe(head.stateHash);
    expect(
      combined[0]?.projection.map(
        ({ userId, role, identityBundleFingerprint }) => ({
          userId,
          role,
          identityBundleFingerprint,
        }),
      ),
    ).toEqual(
      [...current.entry.projection].sort((a, b) =>
        a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0,
      ),
    );
    expect(artifactRead.artifacts).toEqual(actual);
  });
}

test("policy artifact batch preserves the verified bundle and missing-payload error", async () => {
  const { head } = await principalHistoryPreparationFixture({
    versions: 2,
    currentArtifacts: true,
    initiallyOrdinaryMember: true,
  });
  await db.transaction(async (tx) => {
    const state = await getCurrentPrincipalState("group", head.principalId, tx);
    if (!state) throw new Error("Missing policy fixture");
    const history = await getVerifiedPrincipalHistory(tx, state, [head]);
    const originalCounter = { statements: 0 };
    const expected = await withDatabaseStatementCounter(originalCounter, () =>
      buildPrincipalPolicyCurrentForStateWithExecutor(tx, state),
    );
    const batchedCounter = { statements: 0 };
    const actual = await withDatabaseStatementCounter(batchedCounter, () =>
      buildPrincipalPolicyCurrentForStateWithExecutor(tx, state, history),
    );
    expect(actual).toEqual(expected);
    expect(originalCounter.statements).toBe(4);
    expect(batchedCounter.statements).toBe(1);
    const staleRead: PrincipalPolicyArtifactRead = {
      stateHash: "stale-head",
      artifacts: { payload: null, memberEnvelopes: [] },
    };
    expect(
      await buildPrincipalPolicyCurrentForStateWithExecutor(
        tx,
        state,
        history,
        staleRead,
      ),
    ).toEqual(expected);
    await tx
      .delete(principalStatePayloads)
      .where(
        and(
          eq(principalStatePayloads.principalId, head.principalId),
          eq(principalStatePayloads.stateHash, head.stateHash),
        ),
      );
    for (const verified of [undefined, history]) {
      const counter = { statements: 0 };
      await expect(
        withDatabaseStatementCounter(counter, () =>
          buildPrincipalPolicyCurrentForStateWithExecutor(tx, state, verified),
        ),
      ).rejects.toMatchObject({
        message: "Principal state payload not found",
        status: 500,
      });
      expect(counter.statements).toBe(1);
    }
  });
});
