import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { SecurityIncidentContext } from "../../data/shared/securityIncidents";
import {
  isReportedRosterVouchedRecipient,
  loadServedStateEnvelopes,
} from "./recipientAdmission";

const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const STATE_HASH = "b".repeat(64);

// The real API client marks a 200 that names another state as a shape
// failure; the admission must surface it as tampering, not as an outage, and
// keep a 404 a plain refusal.
test("served envelopes for another state fail verification through the API client", async () => {
  const responses = [
    Response.json({
      envelopes: [],
      epoch: 1,
      principalId: PRINCIPAL_ID,
      principalType: "group",
      stateHash: "d".repeat(64),
    }),
    Response.json({ error: "Principal state not found" }, { status: 404 }),
  ];
  const server = Bun.serve({
    fetch: () => responses.shift() ?? new Response(null, { status: 500 }),
    port: 0,
  });
  try {
    const apiClient = new ApiClient(server.url.origin);
    const state = {
      principalId: PRINCIPAL_ID,
      principalType: "group" as const,
      stateHash: STATE_HASH,
    };

    await expect(
      loadServedStateEnvelopes(apiClient, state),
    ).rejects.toBeInstanceOf(KeyingVerificationError);
    expect(await loadServedStateEnvelopes(apiClient, state)).toBeNull();
  } finally {
    await server.stop(true);
  }
});

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
