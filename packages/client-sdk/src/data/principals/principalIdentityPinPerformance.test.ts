import { expect, test } from "bun:test";
import { principalIdentityPinFixture } from "../../../test/helpers/principalIdentityPinFixture";

test("a partially pinned policy resolves only the unpinned identities", async () => {
  const fixture = await principalIdentityPinFixture(8);
  try {
    for (const member of fixture.members.slice(0, 4))
      await fixture.service.resolve(member.identity.userId);
    fixture.resetCounts();
    await expect(fixture.verify()).resolves.toHaveLength(1);
    console.log("review-sdk-pins-partial", JSON.stringify(fixture.counts()));
    // Staged first sights publish in one write transaction, not one each.
    expect(fixture.counts()).toMatchObject({
      pinSelects: 10,
      transactions: 3,
      writes: 4,
      loads: 4,
      requests: 4,
    });
  } finally {
    fixture.close();
  }
});

for (const memberCount of [2, 8, 32]) {
  test(`cached policy batches immutable pins for ${memberCount} members`, async () => {
    const fixture = await principalIdentityPinFixture(memberCount);
    try {
      fixture.resetCounts();
      await expect(fixture.verify()).resolves.toHaveLength(1);
      const cold = fixture.counts();
      fixture.resetCounts();
      await expect(fixture.verify()).resolves.toHaveLength(1);
      const warm = fixture.counts();
      for (const member of fixture.members)
        fixture.api.evictUserIdentity(member.identity.userId);
      fixture.resetCounts();
      await expect(fixture.verify()).resolves.toHaveLength(1);
      const evicted = fixture.counts();
      console.log(
        "review-sdk-pins",
        JSON.stringify({ memberCount, cold, warm, evicted }),
      );
      expect(cold.requests).toBe(memberCount);
      expect(cold.writes).toBe(memberCount);
      // Pin load, publication's match read, and one write for every member.
      expect(cold.transactions).toBe(3);
      expect(warm).toMatchObject({
        pinSelects: 1,
        transactions: 1,
        writes: 0,
        loads: 0,
        requests: 0,
      });
      expect(warm.sql).toBe(4);
      expect(evicted).toEqual(warm);
    } finally {
      fixture.close();
    }
  });
}
