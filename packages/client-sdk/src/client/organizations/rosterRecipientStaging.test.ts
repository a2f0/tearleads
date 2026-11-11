import { expect, test } from "bun:test";
import { computeUserIdentityBundleFingerprint } from "@tearleads/crypto";
import { principalIdentityPinFixture } from "../../../test/helpers/principalIdentityPinFixture";
import {
  evidence,
  GOOD_KEY,
  identityResponse,
  membersHistory,
  SUBSTITUTED_KEY,
  VERIFIED_ADMIN_A,
} from "../../workflows/organizations/memberships/rosterAdmission.testFixtures";
import { isReportedRosterVouchedRecipient } from "./recipientAdmission";

test("a substituted roster recipient leaves no pin and a corrected retry admits", async () => {
  const fixture = await principalIdentityPinFixture(1);
  try {
    const carol = crypto.randomUUID();
    const history = await membersHistory([
      { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
      {
        members: { "admin-a": "c".repeat(64), [carol]: GOOD_KEY },
        signer: "admin-a",
      },
    ]);
    // The real gateway's durable store answers every pin read.
    const served = evidence(history, VERIFIED_ADMIN_A, {
      async loadPin(userId) {
        if (userId === "admin-a") return VERIFIED_ADMIN_A["admin-a"];
        const pin = await fixture.service.loadAdmissionPin(
          userId,
          fixture.execSql,
        );
        return pin
          ? {
              encapsulationKeyFingerprint:
                pin.identity.encapsulationKeyFingerprint,
              identityBundleFingerprint:
                await computeUserIdentityBundleFingerprint(pin.identity),
              signingKeyFingerprint: pin.identity.signingKeyFingerprint,
              verified: pin.verified,
            }
          : null;
      },
    });
    const admit = () =>
      isReportedRosterVouchedRecipient({
        evidence: served,
        organizationId: "org-1",
        reportSecurityIncident: async () => {},
        resolveTrustedUserIdentity: fixture.service.resolve,
        userId: carol,
      });
    const pins = () =>
      fixture.execSql(
        "SELECT provenance FROM trusted_user_identity_pins WHERE user_id = ?",
        [carol],
      );
    fixture.responses.set(
      carol,
      await identityResponse(carol, SUBSTITUTED_KEY),
    );
    await expect(admit()).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(await pins()).toEqual([]);
    // No pin reset: the server's corrected answer admits on retry.
    fixture.responses.set(carol, await identityResponse(carol, GOOD_KEY));
    await expect(admit()).resolves.toBe(true);
    expect(await pins()).toEqual([{ provenance: "observed" }]);
  } finally {
    fixture.close();
  }
});
