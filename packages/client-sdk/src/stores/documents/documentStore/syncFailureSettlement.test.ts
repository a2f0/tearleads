import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { settleScheduledSyncFailure } from "./syncFailureSettlement";

function createState(input: {
  readonly incidents: unknown[];
  readonly logs: string[];
}) {
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
  } as unknown as Parameters<typeof settleScheduledSyncFailure>[0];
}

test("a stale ancestor citation ends the pass without an incident", async () => {
  // The device cannot tell that ordering from a stale delivery until a later
  // event on the container cites the current heads; the next trigger retries.
  const incidents: unknown[] = [];
  const logs: string[] = [];

  const settled = await settleScheduledSyncFailure(
    createState({ incidents, logs }),
    new KeyingVerificationError(
      "stale_citation",
      "path[1] cites a stale head of ancestor container root",
    ),
  );

  expect(settled).toBe(true);
  expect(incidents).toEqual([]);
  expect(logs).toEqual([
    "Document sync: deferred document-1 because a container head cites a stale ancestor head; a later event on the container that cites the current heads supersedes it.",
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
