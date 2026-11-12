import { expect, test } from "bun:test";
import {
  evidence,
  GOOD_KEY,
  membersHistory,
  pin,
  VERIFIED_ADMIN_A,
} from "./rosterAdmission.testFixtures";
import { isRosterVouchedRecipient } from "./rosterVouchedAdmission";

const a = "c".repeat(64);
const b = "d".repeat(64);

test("a later admission cannot retroactively authenticate a signer", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": a }, signer: "admin-a" },
    { members: { "admin-a": a, carol: GOOD_KEY }, signer: "admin-b" },
    {
      members: { "admin-a": a, carol: GOOD_KEY, "admin-b": b },
      signer: "admin-a",
    },
  ]);
  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        "admin-b": await pin("admin-b", false, b),
        carol: await pin("carol", false),
      }),
    ),
  ).toBe(false);
});

test("a circular set of observed identities cannot authorize itself", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": a }, signer: "admin-b" },
    { members: { "admin-a": a, "admin-b": b }, signer: "admin-a" },
    {
      members: { "admin-a": a, "admin-b": b, carol: GOOD_KEY },
      signer: "admin-b",
    },
  ]);
  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        "admin-a": await pin("admin-a", false, a),
        "admin-b": await pin("admin-b", false, b),
        carol: await pin("carol", false),
      }),
    ),
  ).toBe(false);
});

test("a historical member can authenticate an external admin who departed before its action", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": a }, signer: "admin-a" },
    { members: { "admin-a": a, "admin-b": b }, signer: "admin-a" },
    { members: { "admin-a": a }, signer: "admin-a" },
    { members: { "admin-a": a, carol: GOOD_KEY }, signer: "admin-b" },
  ]);
  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        "admin-b": await pin("admin-b", false, b),
        carol: await pin("carol", false),
      }),
    ),
  ).toBe(true);
});

test("a direct self/link anchor is checked before requiring historical Members membership", async () => {
  const fixture = await membersHistory([
    { members: { carol: GOOD_KEY }, signer: "admin-a" },
  ]);
  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        carol: await pin("carol", false),
      }),
    ),
  ).toBe(true);
});

test("unavailable history and bounded history exhaustion refuse admission", async () => {
  const fixture = await membersHistory(
    Array.from({ length: 130 }, () => ({
      members: { "admin-a": a, carol: GOOD_KEY },
      signer: "admin-a",
    })),
  );
  const served = evidence(fixture, {
    ...VERIFIED_ADMIN_A,
    carol: await pin("carol", false),
  });
  let pages = 0;
  expect(
    await isRosterVouchedRecipient("carol", {
      ...served,
      async loadHistoryPage(...args) {
        pages += 1;
        return served.loadHistoryPage(...args);
      },
    }),
  ).toBe(false);
  expect(pages).toBe(64);
  expect(
    await isRosterVouchedRecipient("carol", {
      ...served,
      loadHistoryPage: async () => ({
        entries: [],
        nextBeforeVersion: null,
        predecessor: null,
      }),
    }),
  ).toBe(false);
});

test("an intermediate signer must match its full pinned domain and keys", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": a }, signer: "admin-a" },
    { members: { "admin-a": a, "admin-b": b }, signer: "admin-a" },
    {
      members: { "admin-a": a, "admin-b": b, carol: GOOD_KEY },
      signer: "admin-b",
    },
  ]);
  await expect(
    isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        "admin-b": await pin("admin-b", false, b, "https://other.example.test"),
        carol: await pin("carol", false),
      }),
    ),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
});

test("admission depth is bounded independently of the single history scan", async () => {
  const members: Record<string, string> = { "admin-a": a };
  const specs = [{ members: { ...members }, signer: "admin-a" }];
  const pins: Record<string, Awaited<ReturnType<typeof pin>>> = {
    ...VERIFIED_ADMIN_A,
  };
  for (let index = 0; index < 65; index += 1) {
    const userId = `member-${index}`;
    members[userId] = GOOD_KEY;
    pins[userId] = await pin(userId, false);
    specs.push({
      members: { ...members },
      signer: index === 0 ? "admin-a" : `member-${index - 1}`,
    });
  }
  const fixture = await membersHistory(specs);
  expect(
    await isRosterVouchedRecipient("member-64", evidence(fixture, pins)),
  ).toBe(false);
  fixture.entries.pop();
  expect(
    await isRosterVouchedRecipient("member-63", evidence(fixture, pins)),
  ).toBe(true);
});
