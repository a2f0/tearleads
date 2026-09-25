import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { applyPrincipalContainerRematerializations } from "./principalContainerRematerialization";

test("group policies with no container grants need no rematerialization", async () => {
  await expect(
    db.transaction((executor) =>
      applyPrincipalContainerRematerializations({
        executor,
        fingerprint: "signer-fingerprint",
        isExactReplay: false,
        nextHead: {
          principalType: "group",
          principalId: crypto.randomUUID(),
          version: 2,
          keyEpoch: 2,
          stateHash: "next-state",
          keyFingerprint: "next-fingerprint",
        },
        nextGrants: [],
        previousGrants: [],
        organizationId: crypto.randomUUID(),
        previousKeyEpoch: 1,
        requests: [],
        userId: crypto.randomUUID(),
      }),
    ),
  ).resolves.toEqual([]);
});
