import { expect, test } from "bun:test";
import { createOrganizationHistoryFixture } from "../../../../test/helpers/organizationPolicyHistory";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { createPublicHistoryFixture } from "../../../../test/helpers/publicPrincipalHistory";
import { createFixtureUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import type { TrustedUserIdentity } from "../../../data/trustedUserIdentity";
import { recoverProjectionPolicyHistory } from "./recoverProjectionPolicyHistory";

test("a warm public prefix rejects a substituted member identity", async () => {
  const data = await createOrganizationHistoryFixture();
  let substitute: TrustedUserIdentity | null = null;
  const http = await createPublicHistoryFixture(
    {
      bundle: data.afterAddition,
      resolveTrustedUserIdentity: async (userId) =>
        userId === data.targetUserId && substitute
          ? substitute
          : data.resolveTrustedUserIdentity(userId),
    },
    data.projectionBundles,
  );
  try {
    const options = {
      ...http.options,
      organizationId: data.organizationId,
      evidence: data.projectionEvidence(),
      references: [principalPolicyHead(data.added)],
    };
    const cold = await recoverProjectionPolicyHistory(options);
    // The target is a member, never a signer, of the cited group.
    expect(
      cold.some((policy) =>
        policy.projection.some(({ userId }) => userId === data.targetUserId),
      ),
    ).toBe(true);
    const { identity } = await createFixtureUserIdentity({
      userId: data.targetUserId,
    });
    substitute = identity as TrustedUserIdentity;
    http.requests.length = 0;
    // Completed prefixes read nothing, so only the selection can catch it.
    await expect(recoverProjectionPolicyHistory(options)).rejects.toMatchObject(
      { code: "hash_mismatch" },
    );
    await expect(
      recoverProjectionPolicyHistory({ ...options, offline: true }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(http.requests).toEqual([]);
  } finally {
    http.close();
  }
});
