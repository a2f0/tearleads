import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair, unwrapDek } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createSuccessorGroupPolicyBundle } from "../../../test/helpers/groupPolicyFixtures";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { recoverPrincipalPolicyHistory } from "../../workflows/principals/recoverPrincipalPolicyHistory";
import {
  principalHistoryRetentionTables,
  principalKeyEnvelopeArchive,
} from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import { ensureSqlTables } from "../sqlite/sqlSchema";
import { loadPrincipalKeyEnvelopeCandidates } from "./principalKeyEnvelopeCandidates";

test.each([false, true])(
  "completed stage reclamation preserves recipient keys: rotated=%s",
  async (rotated) => {
    const history = await signedRecoveryHistory(1);
    const previous = history.bundle;
    const state = previous.currentState;
    const oldKey = await unwrapDek(
      previous.currentMemberEnvelopes.envelopes.map((envelope) => ({
        keyFingerprint: envelope.memberKeyFingerprint,
        kemCipherText: base64ToBytes(envelope.kemCipherText),
        wrappedKey: base64ToBytes(envelope.wrappedKey),
      })),
      history.memberKey.secretKey,
    );
    const author = {
      organizationId: "org-1",
      signerUserId: state.signerUserId,
      signerDeviceId: "history-retention-test",
      signerKeyFingerprint: state.signerUserKeyFingerprint,
      signerPrivateKey: history.signingPrivateKey,
    };
    const nextKey = rotated
      ? generateKemSeedAndKeyPair()
      : {
          publicKey: base64ToBytes(state.encapsulationPublicKey),
          secretKey: oldKey,
        };
    const next = await createSuccessorGroupPolicyBundle({
      author,
      groupId: state.principalId,
      groupKem: nextKey,
      keyEpoch: rotated ? 2 : 1,
      memberPublicKey: history.memberKey.publicKey,
      previousBundle: previous,
      signedAt: "2026-10-06T00:00:01.000Z",
      userId: state.signerUserId,
    });
    const latest = await createSuccessorGroupPolicyBundle({
      author,
      groupId: state.principalId,
      groupKem: nextKey,
      keyEpoch: next.currentState.keyEpoch,
      memberPublicKey: history.memberKey.publicKey,
      previousBundle: next,
      signedAt: "2026-10-06T00:00:02.000Z",
      userId: state.signerUserId,
    });
    const f = await createRecoveryFixture(
      { ...history, bundle: latest, expectedHead: principalPolicyHead(latest) },
      [previous, next],
    );
    try {
      await ensureSqlTables(f.options.execSql, principalHistoryRetentionTables);
      await recoverPrincipalPolicyHistory({
        ...f.options,
        expectedHead: history.expectedHead,
      });
      await recoverPrincipalPolicyHistory({
        ...f.options,
        expectedHead: principalPolicyHead(next),
      });
      await recoverPrincipalPolicyHistory(f.options);
      expect(await f.db.select().from(principalHistoryStages)).toHaveLength(2);
      expect(
        await f.db.select().from(principalKeyEnvelopeArchive),
      ).toHaveLength(rotated ? 2 : 1);
      const archived = await loadPrincipalKeyEnvelopeCandidates(
        f.options.execSql,
        [state.keyFingerprint],
      );
      expect(archived).toHaveLength(1);
      const restoredKey = await unwrapDek(
        archived.flatMap((candidate) =>
          candidate.currentMemberEnvelopes.envelopes.map((envelope) => ({
            keyFingerprint: envelope.memberKeyFingerprint,
            kemCipherText: base64ToBytes(envelope.kemCipherText),
            wrappedKey: base64ToBytes(envelope.wrappedKey),
          })),
        ),
        history.memberKey.secretKey,
      );
      expect(restoredKey).toEqual(oldKey);
    } finally {
      f.close();
    }
  },
  15_000,
);
