import { beforeAll, expect, test } from "bun:test";
import { signPrincipalState, wrapDekForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalKeyEnvelopeCandidates } from "../../data/persistence/principalKeyEnvelopeCandidates";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../data/principals/principalPolicyCrypto";
import {
  principalHistoryEntries,
  principalHistoryPrefixes,
} from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { recoverPrincipalPolicyHistory } from "../principals/recoverPrincipalPolicyHistory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

test("compound current acknowledgement retains protected artifacts and pins without full bundles or HTTP", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    const requests = f.requests.length;
    const beforeEntries = await f.db.select().from(principalHistoryEntries);
    const beforeStages = await f.db.select().from(principalHistoryStages);
    const policies = await retainAcknowledgedPrincipalCurrents(f.publication);
    expect(policies.map((policy) => policy.version)).toEqual([67, 67]);
    expect(
      policies.every((policy) => policy.retainedHistory.length === 2),
    ).toBe(true);
    expect(f.requests).toHaveLength(requests);
    const historicalKeys = await loadPrincipalKeyEnvelopeCandidates(
      f.options.execSql,
      [history.directory.currentState.keyFingerprint],
    );
    expect(
      historicalKeys.some(
        (candidate) =>
          JSON.stringify(candidate.currentMemberEnvelopes) ===
          JSON.stringify(history.directory.currentMemberEnvelopes),
      ),
    ).toBe(true);
    expect(await f.db.select().from(principalHistoryEntries)).toHaveLength(
      beforeEntries.length + 2,
    );
    const stages = await f.db.select().from(principalHistoryStages);
    expect(stages).toHaveLength(beforeStages.length + 2);
    for (const prior of beforeStages) expect(stages).toContainEqual(prior);
    for (const entry of f.publication.entries) {
      const recovered = await recoverPrincipalPolicyHistory({
        ...entry.recovery,
        execSql: f.publication.execSql,
        organizationId: history.organizationId,
        expectedHead: principalPolicyHead(entry.response),
        offline: true,
        stillCurrent: () => true,
      });
      expect(recovered.current).not.toHaveProperty("previousStates");
      expect(recovered.current.currentMemberEnvelopes).toEqual(
        entry.response.currentMemberEnvelopes,
      );
      expect(recovered.policy.stateHash).toBe(
        entry.response.currentState.stateHash,
      );
      expect(
        await loadPrincipalPolicyCheckpoint(
          f.options.execSql,
          entry.response.currentState.principalType,
          entry.response.currentState.principalId,
        ),
      ).toEqual(recovered.policy.checkpoint);
    }
    expect(f.requests).toHaveLength(requests);
    expect(
      (await f.db.select().from(principalHistoryPrefixes)).every(
        (row) => !Object.hasOwn(JSON.parse(row.currentJson), "previousStates"),
      ),
    ).toBe(true);
  } finally {
    f.close();
  }
});

test("a mismatched organization receipt cannot publish either half of a compound acknowledgement", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    const before = await f.db.select().from(principalHistoryPrefixes);
    const organization = f.publication.entries[1];
    if (!organization) throw new Error("Missing organization receipt");
    organization.response.currentState.signature = "substituted";
    await expect(
      retainAcknowledgedPrincipalCurrents(f.publication),
    ).rejects.toThrow("acknowledgement mismatch");
    expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(before);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        history.group.currentState.principalId,
      ),
    ).toMatchObject({ version: 66 });
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "organization",
        history.organizationId,
      ),
    ).toMatchObject({ version: 66 });
  } finally {
    f.close();
  }
});

test("a rotated organization keeps its historical object key usable from completed current artifacts", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapDekForRecipients(key, [
      base64ToBytes(history.directory.currentState.encapsulationPublicKey),
    ]);
    await retainAcknowledgedPrincipalCurrents(f.publication);
    expect(f.publication.entries[1]?.response.currentState.keyEpoch).toBe(
      history.directory.currentState.keyEpoch + 1,
    );
    const unwrapped = await unwrapKeyEnvelopesWithPrincipalPolicies({
      execSql: f.options.execSql,
      secretKey: history.creatorEncapsulationKeyPair.secretKey,
      envelopes: wrapped.map((envelope) => ({
        keyFingerprint: envelope.keyFingerprint,
        kemCipherText: bytesToBase64(envelope.kemCipherText),
        wrappedKey: bytesToBase64(envelope.wrappedKey),
      })),
    });
    expect(unwrapped).toEqual(key);
  } finally {
    f.close();
  }
});

test("current publication captures the authored request and receipt before asynchronous restoration", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    const first = f.publication.entries[0];
    if (!first) throw new Error("Missing group receipt");
    const signature = first.request.state.signature;
    const resigned = await signPrincipalState(
      first.request.state,
      history.signingKeyPair.signingPrivateKey,
    );
    const pending = retainAcknowledgedPrincipalCurrents(f.publication);
    first.request.state.signature = resigned.signature;
    first.response.currentState.signature = resigned.signature;
    const policies = await pending;
    expect(policies[0]?.state.signature).toBe(signature);
  } finally {
    f.close();
  }
});
