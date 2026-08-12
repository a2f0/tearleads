import { expect, test } from "bun:test";
import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { applyPrincipalContainerRematerializations } from "./principalContainerRematerialization";

function executorReturning(rows: readonly Record<string, unknown>[]) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          leftJoin: () => ({
            where: async () => rows,
          }),
        }),
      }),
    }),
  } as unknown as DatabaseTransaction;
}

test("organization successors fail closed instead of claiming foreign container writes", async () => {
  const organizationId = crypto.randomUUID();

  await expect(
    applyPrincipalContainerRematerializations({
      executor: executorReturning([
        {
          accessLevel: "read",
          containerId: crypto.randomUUID(),
          keyEpoch: 1,
          keyFingerprint: "previous-fingerprint",
          stateHash: "previous-state",
          version: 1,
        },
      ]),
      fingerprint: "signer-fingerprint",
      isExactReplay: false,
      nextHead: {
        principalType: "organization",
        principalId: organizationId,
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
  ).rejects.toMatchObject({
    message:
      "Organization principal changes with existing container grants are not supported",
    status: 409,
  });
});

test("organization successors remain valid when no container references need rematerialization", async () => {
  await expect(
    applyPrincipalContainerRematerializations({
      executor: executorReturning([]),
      fingerprint: "signer-fingerprint",
      isExactReplay: false,
      nextHead: {
        principalType: "organization",
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

test("organization policies reject caller-supplied container rematerializations", async () => {
  await expect(
    applyPrincipalContainerRematerializations({
      executor: executorReturning([]),
      fingerprint: "signer-fingerprint",
      isExactReplay: false,
      nextHead: {
        principalType: "organization",
        principalId: crypto.randomUUID(),
        version: 2,
        keyEpoch: 2,
        stateHash: "next-state",
        keyFingerprint: "next-fingerprint",
      },
      nextGrants: [],
      previousKeyEpoch: 1,
      requests: [{} as ContainerMutationRequest],
      userId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({
    message:
      "Organization principal policies cannot include container rematerializations",
    status: 409,
  });
});
