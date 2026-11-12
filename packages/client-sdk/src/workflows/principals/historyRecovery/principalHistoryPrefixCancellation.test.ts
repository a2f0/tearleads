import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../../test/helpers/principalHistoryRecovery";
import { principalIdentityPinFixture } from "../../../../test/helpers/principalIdentityPinFixture";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

test("a restored-prefix recovery cancelled during its selected check pins nothing", async () => {
  const history = await signedRecoveryHistory(2);
  const owner = await history.resolveTrustedUserIdentity(
    history.bundle.currentState.signerUserId,
  );
  if (!owner) throw new Error("Missing fixture owner");
  const fixture = await createRecoveryFixture(history);
  const pins = await principalIdentityPinFixture(1);
  try {
    // A completed recovery leaves a reusable prefix: the retry fetches no
    // page, so its selected-history check is the only identity lookup.
    await recoverPrincipalPolicyHistory(fixture.options);
    fixture.requests.length = 0;
    pins.responses.set(owner.userId, {
      userId: owner.userId,
      signingPublicKey: bytesToBase64(owner.signingPublicKey),
      signingKeyFingerprint: owner.signingKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(owner.encapsulationPublicKey),
      encapsulationKeyFingerprint: owner.encapsulationKeyFingerprint,
    });
    let cancelled = false;
    const served = pins.responses.get.bind(pins.responses);
    pins.responses.get = (userId: string) => {
      cancelled = true;
      return served(userId);
    };
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        historyReader: fixture.client(),
        resolveTrustedUserIdentity: pins.service.resolve,
        stillCurrent: () => !cancelled,
      }),
    ).rejects.toThrow();
    expect(fixture.requests).toEqual([]);
    expect(cancelled).toBe(true);
    expect(
      await pins.execSql(
        "SELECT provenance FROM trusted_user_identity_pins WHERE user_id = ?",
        [owner.userId],
      ),
    ).toEqual([]);
  } finally {
    fixture.close();
    pins.close();
  }
});
