import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import {
  type ScheduledSyncFailureState,
  settleScheduledSyncFailure,
} from "./syncFailureSettlement";

function createState(input: {
  readonly incidents: unknown[];
  readonly logs: string[];
}): ScheduledSyncFailureState {
  return {
    localId: "local-1",
    record: { documentId: "document-1" },
    runtime: {
      util: {
        log: (message: string) => {
          input.logs.push(message);
        },
        reportSecurityIncident: async (error: unknown) => {
          input.incidents.push(error);
        },
      },
    },
  };
}

test("a stale ancestor citation is recorded, named, and shown by the lane", async () => {
  // The device cannot tell that member's last honest event from one committed
  // later with the server's help; only a later event on the container by a
  // member with current authority resolves it. The refusal is recorded and
  // named, and the pass fails like any other verification failure.
  const incidents: unknown[] = [];
  const logs: string[] = [];
  const staleCitation = new KeyingVerificationError(
    "stale_citation",
    "path[1] cites a stale head of ancestor container root",
  );
  const failure = new Error("sync pass failed", { cause: staleCitation });

  await expect(
    settleScheduledSyncFailure(createState({ incidents, logs }), failure),
  ).rejects.toBe(failure);
  expect(incidents).toEqual([staleCitation]);
  expect(logs).toEqual([
    "Document sync: will retry document-1; a container head cites a stale ancestor head and its signer holds no current authority, and only a later event on the container by a member with current authority supersedes it.",
  ]);
});

test("any other verification failure is reported and rethrown", async () => {
  const incidents: unknown[] = [];
  const logs: string[] = [];
  const rollback = new KeyingVerificationError(
    "rollback",
    "access manifest is older than the local checkpoint",
  );

  await expect(
    settleScheduledSyncFailure(createState({ incidents, logs }), rollback),
  ).rejects.toBe(rollback);
  expect(incidents).toEqual([rollback]);
  expect(logs).toEqual([]);
});
