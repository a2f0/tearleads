import { expect, test } from "bun:test";
import { computePrincipalMemberEnvelopesRoot } from "@tearleads/crypto";
import {
  evidence,
  GOOD_KEY,
  membersHistory,
  pin,
  SUBSTITUTED_KEY,
  VERIFIED_ADMIN_A,
} from "./rosterAdmission.testFixtures";
import { isRosterVouchedRecipient } from "./rosterVouchedAdmission";

test("an authenticated historical envelope contradicting a pin is a hard mismatch", async () => {
  const admin = "c".repeat(64);
  const fixture = await membersHistory([
    { members: { "admin-a": admin }, signer: "admin-a" },
    { members: { "admin-a": admin, carol: GOOD_KEY }, signer: "admin-a" },
    { members: { "admin-a": admin, carol: GOOD_KEY }, signer: "admin-a" },
  ]);
  const admission = fixture.entries[1];
  if (!admission) throw new Error("Missing admission state");
  const substituted = await pin("carol", false, SUBSTITUTED_KEY);
  const envelopes = (
    fixture.envelopesByHash.get(admission.state.stateHash) ?? []
  ).map((envelope) =>
    envelope.userId === "carol"
      ? {
          ...envelope,
          memberKeyFingerprint: substituted.encapsulationKeyFingerprint,
        }
      : envelope,
  );
  // The verified-history port attests this root. It is not a malformed or
  // root-mismatching transport response: the signed envelope itself is wrong.
  admission.state.memberEnvelopesRoot =
    await computePrincipalMemberEnvelopesRoot(envelopes);
  fixture.envelopesByHash.set(admission.state.stateHash, envelopes);
  await expect(
    isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        carol: await pin("carol", false),
      }),
    ),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
});
