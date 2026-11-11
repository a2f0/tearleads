import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { CurrentPrincipalMemberEnvelopesResponse } from "@tearleads/validators/response";
import {
  evidence,
  GOOD_KEY,
  membersHistory,
  pin,
  SUBSTITUTED_KEY,
  VERIFIED_ADMIN_A,
} from "./rosterAdmission.testFixtures";
import { isRosterVouchedRecipient } from "./rosterVouchedAdmission";

test("a pinned signing-key substitution fails even when the encryption key is unchanged", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
  ]);
  await expect(
    isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        carol: {
          ...(await pin("carol", false)),
          identityBundleFingerprint: SUBSTITUTED_KEY,
        },
      }),
    ),
  ).rejects.toBeInstanceOf(KeyingVerificationError);
});

test("a current committed KEM substitution is a hard identity mismatch", async () => {
  const fixture = await membersHistory([
    {
      members: { "admin-a": "c".repeat(64), carol: SUBSTITUTED_KEY },
      signer: "admin-a",
    },
  ]);
  await expect(
    isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        carol: await pin("carol", false),
      }),
    ),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
});

test("a transitively vouched admin may admit a member after that admin has departed", async () => {
  const a = "c".repeat(64);
  const b = "d".repeat(64);
  const fixture = await membersHistory([
    { members: { "admin-a": a }, signer: "admin-a" },
    { members: { "admin-a": a, "admin-b": b }, signer: "admin-a" },
    {
      members: { "admin-a": a, "admin-b": b, carol: GOOD_KEY },
      signer: "admin-b",
    },
    { members: { "admin-a": a, carol: GOOD_KEY }, signer: "admin-a" },
  ]);
  let pages = 0;
  const served = evidence(fixture, {
    ...VERIFIED_ADMIN_A,
    "admin-b": await pin("admin-b", false, b),
    carol: await pin("carol", false),
  });
  expect(
    await isRosterVouchedRecipient("carol", {
      ...served,
      async loadHistoryPage(...args) {
        pages += 1;
        return served.loadHistoryPage(...args);
      },
    }),
  ).toBe(true);
  expect(pages).toBe(2);
});

test("a member added by an admin this device verified is vouched for", async () => {
  // Carol joins at version 2; later states (one per page boundary) keep her.
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    {
      members: {
        "admin-a": "c".repeat(64),
        carol: GOOD_KEY,
        dave: "d".repeat(64),
      },
      signer: "admin-b",
    },
    {
      members: {
        "admin-a": "c".repeat(64),
        carol: GOOD_KEY,
        dave: "d".repeat(64),
      },
      signer: "admin-b",
    },
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

test("an addition signed by an admin this device only observed vouches for no one", async () => {
  const fixture = await membersHistory([
    { members: { "admin-b": "c".repeat(64) }, signer: "admin-b" },
    {
      members: { "admin-b": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-b",
    },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        "admin-b": await pin("admin-b", false, "c".repeat(64)),
        carol: await pin("carol", false),
      }),
    ),
  ).toBe(false);
});

// The server feeds this device, and a later admin who never verified Carol, a
// substituted key; that admin's re-signed state then commits it. Only the
// state that admitted her says which key her verifying admin checked.
test("a key substituted after the vouched addition is refused", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    {
      members: { "admin-a": "c".repeat(64), carol: SUBSTITUTED_KEY },
      signer: "admin-b",
    },
  ]);

  await expect(
    isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        carol: await pin("carol", false, SUBSTITUTED_KEY),
      }),
    ),
  ).rejects.toBeInstanceOf(KeyingVerificationError);
});

// After a removal, a re-addition starts a new membership; an earlier vouched
// addition says nothing about the key the re-adding admin used.
test("only the addition that started the current membership vouches", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-b",
    },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        carol: await pin("carol", false),
      }),
    ),
  ).toBe(false);
});

test("a removed member is not vouched for", async () => {
  const fixture = await membersHistory([
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
  ]);

  expect(
    await isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        ...VERIFIED_ADMIN_A,
        carol: await pin("carol", false),
      }),
    ),
  ).toBe(false);
});

test("a signer whose pinned key differs from the state's signing key is refused", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
  ]);

  await expect(
    isRosterVouchedRecipient(
      "carol",
      evidence(fixture, {
        "admin-a": {
          ...(await pin("admin-a", true, "c".repeat(64))),
          signingKeyFingerprint: "another-signing-key",
        },
        carol: await pin("carol", false),
      }),
    ),
  ).rejects.toBeInstanceOf(KeyingVerificationError);
});

test("envelopes that do not match the vouching state's signed root are rejected", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
  ]);
  const served = evidence(fixture, {
    ...VERIFIED_ADMIN_A,
    carol: await pin("carol", false),
  });

  const result = isRosterVouchedRecipient("carol", {
    ...served,
    async loadStateEnvelopes(state) {
      const genuine = await served.loadStateEnvelopes(state);
      if (!genuine) return null;
      const tampered: CurrentPrincipalMemberEnvelopesResponse = {
        ...genuine,
        envelopes: genuine.envelopes.map((envelope) => ({
          ...envelope,
          memberKeyFingerprint: GOOD_KEY,
        })),
      };
      return tampered;
    },
  });

  await expect(result).rejects.toBeInstanceOf(KeyingVerificationError);
});

// A list that cannot even be normalized (here, a duplicated member) is
// tampering too, so it must fail as a verification error that callers record
// as an incident, not as an envelope validation error.
test("malformed envelopes for the vouching state fail as verification errors", async () => {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
  ]);
  const served = evidence(fixture, {
    ...VERIFIED_ADMIN_A,
    carol: await pin("carol", false),
  });

  const result = isRosterVouchedRecipient("carol", {
    ...served,
    async loadStateEnvelopes(state) {
      const genuine = await served.loadStateEnvelopes(state);
      if (!genuine) return null;
      return {
        ...genuine,
        envelopes: [...genuine.envelopes, ...genuine.envelopes],
      };
    },
  });

  await expect(result).rejects.toBeInstanceOf(KeyingVerificationError);
});
