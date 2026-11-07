import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { SecurityIncidentContext } from "../../data/shared/securityIncidents";
import { isReportedRosterVouchedRecipient } from "./recipientAdmission";

// Roster evidence the server served that fails verification is tampering, not
// a refusal: it is recorded before the share fails, so it outlives the error.
test("roster evidence that fails verification is recorded before the share fails", async () => {
  const events: string[] = [];
  const reports: Array<{ error: unknown; context: SecurityIncidentContext }> =
    [];
  const tampering = new KeyingVerificationError(
    "hash_mismatch",
    "Members state envelopes do not match the signed state",
  );

  const admission = isReportedRosterVouchedRecipient({
    evidence: {
      loadCurrentMembers: async () => {
        throw tampering;
      },
      loadHistoryPage: async () => {
        throw new Error("Unexpected history read");
      },
      loadPin: async () => ({
        encapsulationKeyFingerprint: "a".repeat(64),
        signingKeyFingerprint: "carol-signing",
        verified: false,
      }),
      loadStateEnvelopes: async () => null,
    },
    organizationId: "org-1",
    reportSecurityIncident: async (error, context) => {
      events.push("reported");
      reports.push({ context, error });
    },
    resolveTrustedUserIdentity: async () => ({ userId: "carol" }),
    userId: "carol",
  }).catch((error: unknown) => {
    events.push("rejected");
    throw error;
  });

  await expect(admission).rejects.toBe(tampering);
  expect(events).toEqual(["reported", "rejected"]);
  expect(reports).toEqual([
    {
      context: {
        objectId: "carol",
        objectKind: "user",
        operation: "container.share.roster_vouch",
        organizationId: "org-1",
      },
      error: tampering,
    },
  ]);
});
