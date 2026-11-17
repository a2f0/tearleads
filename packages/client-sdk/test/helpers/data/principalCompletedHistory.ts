import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createSuccessorGroupPolicyBundle } from "./groupPolicyFixtures";
import { signedRecoveryHistory } from "./principalHistoryRecovery";

export async function rotatingCompletedHistory(count: number) {
  const history = await signedRecoveryHistory(1);
  const state = history.bundle.currentState;
  const bundles = [history.bundle];
  const keys = new Map<number, ReturnType<typeof generateKemSeedAndKeyPair>>();
  let previous = history.bundle;
  while (bundles.length < count) {
    const key = generateKemSeedAndKeyPair();
    previous = await createSuccessorGroupPolicyBundle({
      author: {
        organizationId: "org-1",
        signerUserId: state.signerUserId,
        signerDeviceId: "completed-retention",
        signerKeyFingerprint: state.signerUserKeyFingerprint,
        signerPrivateKey: history.signingPrivateKey,
      },
      groupId: state.principalId,
      groupKem: key,
      memberPublicKey: history.memberKey.publicKey,
      previousBundle: previous,
      signedAt: "2026-10-07T00:00:00.000Z",
      userId: state.signerUserId,
    });
    keys.set(previous.currentState.version, key);
    bundles.push(previous);
  }
  return { history, bundles, keys, latest: previous };
}
