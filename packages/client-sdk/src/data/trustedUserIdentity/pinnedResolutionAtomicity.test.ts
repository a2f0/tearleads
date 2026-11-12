import { expect, test } from "bun:test";
import { principalIdentityPinFixture } from "../../../test/helpers/principalIdentityPinFixture";
import { createPin } from "../../../test/helpers/trustedUserIdentityPin";
import { compareOrInsertTrustedUserIdentityPin } from "../persistence/trustedUserIdentityPinPersistence";

test("a staged scope that conflicts on its second pin commits none of its first sights", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    const [first, second] = fixture.members;
    const withPinnedIdentities = fixture.service.resolve.withPinnedIdentities;
    if (!first || !second || !withPinnedIdentities)
      throw new Error("Missing fixture");
    const userIds = [first.identity.userId, second.identity.userId];
    await expect(
      withPinnedIdentities(
        userIds,
        async (resolve) => {
          for (const userId of userIds) await resolve(userId);
          // Another SDK instance on this database pins the second user under
          // different keys after this scope staged both first sights.
          await compareOrInsertTrustedUserIdentityPin({
            execSql: fixture.execSql,
            pin: createPin({
              identityTrustDomain: second.identity.identityTrustDomain,
              userId: second.identity.userId,
            }),
          });
        },
        { publish: true },
      ),
    ).rejects.toMatchObject({ code: "equivocation" });
    expect(
      await fixture.execSql(
        "SELECT user_id FROM trusted_user_identity_pins WHERE user_id = ?",
        [first.identity.userId],
      ),
    ).toEqual([]);
  } finally {
    fixture.close();
  }
});
