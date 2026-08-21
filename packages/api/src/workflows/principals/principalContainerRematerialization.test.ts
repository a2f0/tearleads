import { expect, test } from "bun:test";
import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import { applyPrincipalContainerRematerializations } from "./principalContainerRematerialization";

function emptyGrantExecutor(): DatabaseTransaction {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          leftJoin: () => ({ where: async () => [] }),
        }),
      }),
    }),
  } as unknown as DatabaseTransaction;
}

test("group policies with no container grants need no rematerialization", async () => {
  await expect(
    applyPrincipalContainerRematerializations({
      executor: emptyGrantExecutor(),
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
      previousKeyEpoch: 1,
      requests: [],
      userId: crypto.randomUUID(),
    }),
  ).resolves.toEqual([]);
});
