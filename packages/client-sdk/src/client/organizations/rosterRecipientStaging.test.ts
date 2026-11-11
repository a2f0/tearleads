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

type PinFixture = Awaited<ReturnType<typeof principalIdentityPinFixture>>;

/** Roster admission over the real gateway; only `admin-a` is pre-anchored. */
function gatewayAdmission(
  fixture: PinFixture,
  history: Awaited<ReturnType<typeof membersHistory>>,
  userId: string,
) {
  // The real gateway's durable store answers every other pin read.
  const served = evidence(history, VERIFIED_ADMIN_A, {
    async loadPin(id) {
      if (id === "admin-a") return VERIFIED_ADMIN_A["admin-a"];
      const pin = await fixture.service.loadAdmissionPin(id, fixture.execSql);
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
  return () =>
    isReportedRosterVouchedRecipient({
      evidence: served,
      organizationId: "org-1",
      reportSecurityIncident: async () => {},
      resolveTrustedUserIdentity: fixture.service.resolve,
      userId,
    });
}

function pinsOf(fixture: PinFixture, userId: string) {
  return fixture.execSql(
    "SELECT provenance FROM trusted_user_identity_pins WHERE user_id = ?",
    [userId],
  );
}

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
    const admit = gatewayAdmission(fixture, history, carol);
    const pins = () => pinsOf(fixture, carol);
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

test("a departed admin's unpinned identity is staged and vouched through history", async () => {
  const fixture = await principalIdentityPinFixture(1);
  try {
    const carol = crypto.randomUUID();
    const dave = crypto.randomUUID();
    const anchor = { "admin-a": "c".repeat(64) };
    // Dave admits Carol, then departs: he appears only in older states, and
    // nothing on this device has pinned him.
    const history = await membersHistory([
      { members: anchor, signer: "admin-a" },
      { members: { ...anchor, [dave]: GOOD_KEY }, signer: "admin-a" },
      {
        members: { ...anchor, [dave]: GOOD_KEY, [carol]: GOOD_KEY },
        signer: dave,
      },
      { members: { ...anchor, [carol]: GOOD_KEY }, signer: "admin-a" },
    ]);
    const admit = gatewayAdmission(fixture, history, carol);
    fixture.responses.set(carol, await identityResponse(carol, GOOD_KEY));
    // A substituted answer for the departed signer is refused, pinning no one.
    fixture.responses.set(dave, await identityResponse(dave, SUBSTITUTED_KEY));
    await expect(admit()).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(await pinsOf(fixture, dave)).toEqual([]);
    expect(await pinsOf(fixture, carol)).toEqual([]);
    // The honest answer authenticates the anchored chain; both first sights
    // are published only with the vouched recipient.
    fixture.responses.set(dave, await identityResponse(dave, GOOD_KEY));
    await expect(admit()).resolves.toBe(true);
    expect(await pinsOf(fixture, dave)).toEqual([{ provenance: "observed" }]);
    expect(await pinsOf(fixture, carol)).toEqual([{ provenance: "observed" }]);
  } finally {
    fixture.close();
  }
});
