import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { ContainerContents } from "./containerContents";
import { prepareOrganizationRootRewrapForGroup } from "./organizationRootReshare";

const ADMIN_GROUP_ID = "admins-group-1";
const ORGANIZATION_ID = "org-1";
const EXPECTED_GROUP_HEAD = {
  keyEpoch: 2,
  keyFingerprint: "expected-admins-key-fingerprint",
  principalId: ADMIN_GROUP_ID,
  principalType: "group" as const,
  stateHash: "expected-admins-state-hash",
  version: 2,
};

async function createPreparedRewrap(input: {
  readonly isCurrent: (call: number) => Promise<boolean>;
  readonly rewrap: (call: number) => Promise<boolean>;
}) {
  let currentChecks = 0;
  let refreshes = 0;
  let rewraps = 0;
  const tree = {
    getSnapshot: () => ({
      nodes: [
        {
          id: "root-container",
          organizationId: ORGANIZATION_ID,
          parentId: null,
        },
      ],
    }),
    prepareGroupRewrap: async () => ({
      isCurrent: async () => {
        currentChecks += 1;
        return input.isCurrent(currentChecks);
      },
      rewrap: async () => {
        rewraps += 1;
        return input.rewrap(rewraps);
      },
      status: "prepared" as const,
    }),
    refresh: async () => {
      refreshes += 1;
      return true;
    },
  };
  const prepared = await prepareOrganizationRootRewrapForGroup({
    containerContents: {
      openTree: () => tree,
    } as unknown as ContainerContents,
    groupId: ADMIN_GROUP_ID,
    organizationId: ORGANIZATION_ID,
  });
  if (!prepared) {
    throw new Error("Expected a matching root admin grant");
  }
  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);

  return {
    counts: () => ({ currentChecks, refreshes, rewraps }),
    prepared,
  };
}

test("initial current-check integrity failure stops before re-wrap or refresh", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted Admins identity changed",
  );
  const { counts, prepared } = await createPreparedRewrap({
    isCurrent: async () => {
      throw integrityError;
    },
    rewrap: async () => true,
  });

  await expect(prepared.rewrap()).rejects.toBe(integrityError);
  expect(counts()).toEqual({ currentChecks: 1, refreshes: 0, rewraps: 0 });
});

test("re-wrap integrity failure stops before refresh", async () => {
  const integrityError = new KeyingVerificationError(
    "signature_mismatch",
    "root projection signer changed",
  );
  const { counts, prepared } = await createPreparedRewrap({
    isCurrent: async () => false,
    rewrap: async () => {
      throw integrityError;
    },
  });

  await expect(prepared.rewrap()).rejects.toBe(integrityError);
  expect(counts()).toEqual({ currentChecks: 1, refreshes: 0, rewraps: 1 });
});

test("post-re-wrap current-check integrity failure stops before refresh", async () => {
  const integrityError = new KeyingVerificationError(
    "object_mismatch",
    "root projection belongs to another organization",
  );
  const { counts, prepared } = await createPreparedRewrap({
    isCurrent: async (call) => {
      if (call === 2) {
        throw integrityError;
      }
      return false;
    },
    rewrap: async () => true,
  });

  await expect(prepared.rewrap()).rejects.toBe(integrityError);
  expect(counts()).toEqual({ currentChecks: 2, refreshes: 0, rewraps: 1 });
});

test("post-refresh current-check integrity failure stops the final retry", async () => {
  const integrityError = new KeyingVerificationError(
    "rollback",
    "root projection rolled back",
  );
  const { counts, prepared } = await createPreparedRewrap({
    isCurrent: async (call) => {
      if (call === 2) {
        throw integrityError;
      }
      return false;
    },
    rewrap: async () => {
      throw new Error("response lost");
    },
  });

  await expect(prepared.rewrap()).rejects.toBe(integrityError);
  expect(counts()).toEqual({ currentChecks: 2, refreshes: 1, rewraps: 1 });
});
