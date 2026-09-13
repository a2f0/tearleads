import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { SecurityIncidentContext } from "../../data/securityIncidents";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import { collectHydrationResults } from "./hydrationResults";

test("attachment failures preserve successes and report each integrity failure", async () => {
  const incidents: { error: unknown; context: SecurityIncidentContext }[] = [];
  const invalid = new KeyingVerificationError(
    "signature_mismatch",
    "test signature",
  );
  const values = await collectHydrationResults({
    tasks: [
      {
        blobId: "unavailable",
        run: async () => {
          throw new Error("offline");
        },
      },
      { blobId: "valid", run: async () => new Uint8Array([1, 2, 3]) },
      {
        blobId: "invalid",
        run: async () => {
          throw invalid;
        },
      },
    ],
    reportSecurityIncident: async (error, context) => {
      incidents.push({ error, context });
    },
  });
  expect(values).toEqual([new Uint8Array([1, 2, 3])]);
  expect(incidents).toEqual([
    {
      error: invalid,
      context: {
        operation: "hydrate_attachment",
        objectKind: "blob",
        objectId: "invalid",
      },
    },
  ]);
});

test("attachment isolation preserves expired runtime boundaries", async () => {
  const unavailable = new DatabaseUnavailableError("closed test database");
  await expect(
    collectHydrationResults({
      tasks: [
        {
          blobId: "closed",
          run: async () => {
            throw unavailable;
          },
        },
      ],
    }),
  ).rejects.toBe(unavailable);
  await expect(
    collectHydrationResults({
      tasks: [
        {
          blobId: "cancelled",
          run: async () => {
            assertProjectionVerificationCurrent(() => false);
          },
        },
      ],
    }),
  ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
});
