import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  formatRootAccessOutcome,
  parseRootAccessArgs,
  setIdentityRootAccess,
} from "./rootAccess";

const FINGERPRINT = "ab".repeat(32);

test("root access args require exactly one hex fingerprint", () => {
  expect(parseRootAccessArgs([FINGERPRINT])).toEqual({
    fingerprint: FINGERPRINT,
  });
  expect(() => parseRootAccessArgs([])).toThrow(
    "A signing key fingerprint is required",
  );
  expect(() => parseRootAccessArgs([FINGERPRINT, "--force"])).toThrow(
    "Unknown argument: --force",
  );
  expect(() => parseRootAccessArgs(["not-a-fingerprint"])).toThrow(
    "Fingerprint must be the 64-character lowercase hex signing key fingerprint",
  );
  expect(() => parseRootAccessArgs([FINGERPRINT.toUpperCase()])).toThrow(
    "Fingerprint must be the 64-character lowercase hex signing key fingerprint",
  );
});

test("root access flips is_root for the fingerprint's identity and is idempotent", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const [inserted] = await managed.db
      .insert(users)
      .values({
        defaultOrganizationId: crypto.randomUUID(),
        encapsulationKeyFingerprint: "cd".repeat(32),
        encapsulationPublicKey: "kem",
        fingerprint: FINGERPRINT,
        signingPublicKey: "signing",
      })
      .returning({ id: users.id });
    if (!inserted) {
      throw new Error("expected inserted user");
    }

    const readIsRoot = async () => {
      const [row] = await managed.db
        .select({ isRoot: users.isRoot })
        .from(users)
        .where(eq(users.id, inserted.id));
      return row?.isRoot;
    };

    await expect(readIsRoot()).resolves.toBe(false);

    const granted = await setIdentityRootAccess(managed.db, {
      fingerprint: FINGERPRINT,
      isRoot: true,
    });
    expect(granted).toEqual({ changed: true, userId: inserted.id });
    await expect(readIsRoot()).resolves.toBe(true);

    const repeated = await setIdentityRootAccess(managed.db, {
      fingerprint: FINGERPRINT,
      isRoot: true,
    });
    expect(repeated).toEqual({ changed: false, userId: inserted.id });

    const revoked = await setIdentityRootAccess(managed.db, {
      fingerprint: FINGERPRINT,
      isRoot: false,
    });
    expect(revoked).toEqual({ changed: true, userId: inserted.id });
    await expect(readIsRoot()).resolves.toBe(false);

    await expect(
      setIdentityRootAccess(managed.db, {
        fingerprint: "ef".repeat(32),
        isRoot: true,
      }),
    ).rejects.toThrow("No identity is registered with fingerprint");
  } finally {
    await managed.close();
  }
}, 15_000);

test("root access outcome names the identity and whether anything changed", () => {
  expect(
    formatRootAccessOutcome(FINGERPRINT, true, { changed: true, userId: "u1" }),
  ).toBe(`Identity u1 (${FINGERPRINT}) is now root.`);
  expect(
    formatRootAccessOutcome(FINGERPRINT, false, {
      changed: false,
      userId: "u1",
    }),
  ).toBe(`Identity u1 (${FINGERPRINT}) was already not root.`);
});
