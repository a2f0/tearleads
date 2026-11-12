import { expect, test } from "bun:test";
import { principalIdentityPinFixture } from "../../../test/helpers/principalIdentityPinFixture";
import { createFixtureUserIdentity } from "../../../test/helpers/trustedUserIdentity";

type Fixture = Awaited<ReturnType<typeof principalIdentityPinFixture>>;

function scoped(fixture: Fixture, userId: string, publish: boolean) {
  const { withPinnedIdentities } = fixture.service.resolve;
  if (!withPinnedIdentities) throw new Error("Expected a staging resolver");
  return withPinnedIdentities([userId], async (resolve) => resolve(userId), {
    publish,
  });
}

function pins(fixture: Fixture, userId: string) {
  return fixture.execSql(
    "SELECT signing_key_fingerprint FROM trusted_user_identity_pins WHERE user_id = ?",
    [userId],
  );
}

async function memberFixture() {
  const fixture = await principalIdentityPinFixture(2);
  const member = fixture.members[1];
  if (!member) throw new Error("Expected a second member");
  return { fixture, userId: member.identity.userId, member };
}

test("a publishing scope takes an unpublished scope's answer without another read", async () => {
  const { fixture, userId, member } = await memberFixture();
  try {
    await scoped(fixture, userId, false);
    expect(await pins(fixture, userId)).toEqual([]);
    fixture.resetCounts();
    const published = await scoped(fixture, userId, true);
    expect(published?.signingKeyFingerprint).toBe(
      member.identity.signingKeyFingerprint,
    );
    expect(fixture.counts().requests).toBe(0);
    // The cached answer is now the pinned one, so resolution reuses it.
    await fixture.service.resolve(userId);
    expect(fixture.counts().requests).toBe(0);
    expect(await pins(fixture, userId)).toEqual([
      { signing_key_fingerprint: member.identity.signingKeyFingerprint },
    ]);
  } finally {
    fixture.close();
  }
});

test("a pending answer never reaches ordinary resolution or a later unpublished scope", async () => {
  const { fixture, userId, member } = await memberFixture();
  try {
    // An unpublished scope stages a substitute its caller may yet refuse.
    const substitute = await createFixtureUserIdentity({ userId });
    fixture.responses.set(userId, substitute.response);
    await scoped(fixture, userId, false);
    // The endpoint is corrected: every non-publishing read sees the fix.
    fixture.responses.set(userId, member.response);
    fixture.resetCounts();
    const staged = await scoped(fixture, userId, false);
    expect(staged?.signingKeyFingerprint).toBe(
      member.identity.signingKeyFingerprint,
    );
    expect(fixture.counts().requests).toBe(1);
    fixture.responses.set(userId, substitute.response);
    await scoped(fixture, userId, false);
    fixture.responses.set(userId, member.response);
    fixture.resetCounts();
    const resolved = await fixture.service.resolve(userId);
    expect(resolved?.signingKeyFingerprint).toBe(
      member.identity.signingKeyFingerprint,
    );
    expect(fixture.counts().requests).toBe(1);
    expect(await pins(fixture, userId)).toEqual([
      { signing_key_fingerprint: member.identity.signingKeyFingerprint },
    ]);
  } finally {
    fixture.close();
  }
});

test("a pending answer is not handed across a changed account", async () => {
  const { fixture, userId } = await memberFixture();
  try {
    await scoped(fixture, userId, false);
    fixture.scope.localUserId = crypto.randomUUID();
    fixture.resetCounts();
    await scoped(fixture, userId, true);
    expect(fixture.counts().requests).toBe(1);
  } finally {
    fixture.close();
  }
});
