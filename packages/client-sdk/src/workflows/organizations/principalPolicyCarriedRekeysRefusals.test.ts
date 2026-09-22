import { expect, test } from "bun:test";
import { createMockRequestFailure } from "@tearleads/test-utils";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { readTestGroupName } from "../../../test/helpers/groupMetadata";
import {
  createRemovalFixture,
  mutationObjectIds,
  stubRekeyRequest,
} from "../../../test/helpers/groupRemovalCarryFixture";
import { removeOrganizationGroupUser } from "./principalPolicy";

type Fixture = Awaited<ReturnType<typeof createRemovalFixture>>;

/**
 * A server that refuses every commit for the same named level, counting how
 * often each refusal is reported. `carry` is the caller's; `acknowledge` must
 * never run, since nothing commits.
 */
function refusingRemoval(
  fixture: Fixture,
  carry: (ids: readonly string[]) => readonly string[],
) {
  const submissions: string[][] = [];
  const reported: number[] = [];
  const apiClient: Parameters<
    typeof removeOrganizationGroupUser
  >[0]["apiClient"] = {
    getCurrentPrincipalPolicy: async (principalType, principalId) => {
      if (principalType === "organization") {
        return fixture.getOrganizationPolicy();
      }
      return principalId === fixture.adminGroupId
        ? fixture.adminPolicy
        : fixture.getCurrentPolicy();
    },
    commitOrganizationGroupPolicy: async () => {
      throw new Error("The status-bearing variant is preferred");
    },
    commitOrganizationGroupPolicyResult: async (
      _organizationId,
      _groupId,
      input,
    ) => {
      const attempt = submissions.length;
      submissions.push(mutationObjectIds(input.groupPolicy.containerMutations));
      reported.push(0);
      return createMockRequestFailure({
        code: CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired,
        message: "Container rotation must carry its descendant rekeys",
        report: () => {
          reported[attempt] = (reported[attempt] ?? 0) + 1;
        },
        requiredContainerIds: ["carried-upper"],
        status: 409,
      });
    },
  };
  const remove = () =>
    removeOrganizationGroupUser({
      apiClient,
      beforePolicyCommit: () => undefined,
      execSql: fixture.execSql,
      expectedGroupName: "Operators",
      readEncryptedName: readTestGroupName,
      groupId: fixture.groupId,
      organizationId: fixture.organizationId,
      prepareContainerMutations: async () => ({
        acknowledge: async () => {
          throw new Error("Nothing committed, so nothing to acknowledge");
        },
        carry: async (ids) => carry(ids).map(stubRekeyRequest),
        requests: [stubRekeyRequest("rematerialized")],
      }),
      removedUserId: fixture.removedUserId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
      signerUserId: fixture.signerUserId,
      signingFingerprint: fixture.signingFingerprint,
      signingKeyPair: fixture.signingKeyPair,
    });
  return { remove, reported, submissions };
}

// The retry is answered once. A second refusal means the tree moved under the
// batch; it is the one surfaced, and the first, which the carry answered, is
// not reported as an error.

test("a second refusal ends the attempt and is the one reported", async () => {
  const fixture = await createRemovalFixture();
  try {
    const { remove, reported, submissions } = refusingRemoval(
      fixture,
      (ids) => ["rematerialized", ...ids],
    );
    await expect(remove()).rejects.toThrow("Group policy update failed");
    expect(submissions).toEqual([
      ["rematerialized"],
      ["rematerialized", "carried-upper"],
    ]);
    expect(reported).toEqual([0, 1]);
  } finally {
    fixture.close();
  }
});

// A carry that signs nothing would only meet the same refusal again, so the
// commit is not retried and the refusal already in hand is the one reported.

test("an empty carry reports the first refusal without retrying", async () => {
  const fixture = await createRemovalFixture();
  try {
    const { remove, reported, submissions } = refusingRemoval(
      fixture,
      () => [],
    );
    await expect(remove()).rejects.toThrow("Group policy update failed");
    expect(submissions).toEqual([["rematerialized"]]);
    expect(reported).toEqual([1]);
  } finally {
    fixture.close();
  }
});

// A carry that throws — a named level the batch could only grant, say — is
// the failure surfaced, and the refusal it was answering is reported with it.

test("a carry that throws reports the refusal it was answering", async () => {
  const fixture = await createRemovalFixture();
  try {
    const { remove, reported, submissions } = refusingRemoval(fixture, () => {
      throw new Error("Container carried-upper needs a rekey");
    });
    await expect(remove()).rejects.toThrow(
      "Container carried-upper needs a rekey",
    );
    expect(submissions).toEqual([["rematerialized"]]);
    expect(reported).toEqual([1]);
  } finally {
    fixture.close();
  }
});
