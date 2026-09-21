import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPin } from "../../../test/helpers/trustedUserIdentityPin";
import { createExecSql } from "../sqlite/sqlSchema";
import {
  compareOrInsertTrustedUserIdentityPin,
  loadTrustedUserIdentityPin,
  loadTrustedUserIdForSigningKey,
} from "./trustedUserIdentityPinPersistence";

test("a retained signing fingerprint cannot bind another user in the same trust domain", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-inverse-binding",
  );
  const first = createPin();
  const alias = createPin({ userId: "server-alias" });
  try {
    await compareOrInsertTrustedUserIdentityPin({ execSql, pin: first });
    await expect(
      compareOrInsertTrustedUserIdentityPin({ execSql, pin: alias }),
    ).rejects.toMatchObject({
      code: "trusted_user_identity_pin_mismatch",
      differingFields: ["userId"],
      existing: { userId: first.userId },
      candidate: { userId: alias.userId },
    });
    expect(await loadTrustedUserIdentityPin({ execSql, ...alias })).toBeNull();
    expect(await loadTrustedUserIdentityPin({ execSql, ...first })).toEqual(
      first,
    );
    const otherDomain = {
      ...alias,
      identityTrustDomain: "https://another.example.test",
    };
    expect(
      await compareOrInsertTrustedUserIdentityPin({
        execSql,
        pin: otherDomain,
      }),
    ).toEqual(otherDomain);
  } finally {
    close();
  }
});

test("different adapters racing fingerprint aliases leave exactly one durable identity", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-inverse-binding-race",
  );
  const adapter = () =>
    createExecSql({
      async exec({ sql, bind, rowMode }) {
        return {
          rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
        };
      },
    });
  const candidates = [
    createPin({ userId: "user-a" }),
    createPin({ userId: "user-b" }),
  ];
  try {
    const settled = await Promise.allSettled(
      candidates.map((pin) =>
        compareOrInsertTrustedUserIdentityPin({ execSql: adapter(), pin }),
      ),
    );
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          code: "trusted_user_identity_pin_mismatch",
          differingFields: ["userId"],
        }),
      }),
    ]);
    const stored = await Promise.all(
      candidates.map((pin) => loadTrustedUserIdentityPin({ execSql, ...pin })),
    );
    expect(stored.filter(Boolean)).toHaveLength(1);
  } finally {
    close();
  }
});

test("the bound user for a signing key is scoped to its trust domain", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-bound-user-lookup",
  );
  const pin = createPin();
  try {
    expect(
      await loadTrustedUserIdForSigningKey({
        execSql,
        identityTrustDomain: pin.identityTrustDomain,
        signingKeyFingerprint: pin.signingKeyFingerprint,
      }),
    ).toBeNull();
    await compareOrInsertTrustedUserIdentityPin({ execSql, pin });
    expect(
      await loadTrustedUserIdForSigningKey({
        execSql,
        identityTrustDomain: pin.identityTrustDomain,
        signingKeyFingerprint: pin.signingKeyFingerprint,
      }),
    ).toBe(pin.userId);
    // Registration consults this before contacting the server, so a binding
    // in another trust domain must not make it decline.
    expect(
      await loadTrustedUserIdForSigningKey({
        execSql,
        identityTrustDomain: "https://another.example.test",
        signingKeyFingerprint: pin.signingKeyFingerprint,
      }),
    ).toBeNull();
  } finally {
    close();
  }
});

test("the unique index refuses a second user on one signing key by itself", async () => {
  // Defense in depth below the transaction's lookup: a write that skipped it
  // must fail, not be silently dropped.
  const { close, execSql } = await createTestExecSql(
    "identity-inverse-binding-index",
  );
  const first = createPin();
  const alias = createPin({ userId: "server-alias" });
  try {
    await compareOrInsertTrustedUserIdentityPin({ execSql, pin: first });
    await expect(
      execSql(
        `INSERT INTO trusted_user_identity_pins (
           identity_trust_domain, user_id, format_version, signing_suite,
           signing_public_key, signing_key_fingerprint, encapsulation_suite,
           encapsulation_public_key, encapsulation_key_fingerprint, first_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          alias.identityTrustDomain,
          alias.userId,
          alias.formatVersion,
          alias.signingSuite,
          alias.signingPublicKey,
          alias.signingKeyFingerprint,
          alias.encapsulationSuite,
          alias.encapsulationPublicKey,
          alias.encapsulationKeyFingerprint,
          alias.firstSeenAt,
        ],
      ),
    ).rejects.toThrow(/UNIQUE/);
    expect(await loadTrustedUserIdentityPin({ execSql, ...alias })).toBeNull();
  } finally {
    close();
  }
});
