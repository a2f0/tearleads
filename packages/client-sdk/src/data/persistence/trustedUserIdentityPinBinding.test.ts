import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPin } from "../../../test/helpers/trustedUserIdentityPin";
import {
  trustedUserIdentityPins,
  trustedUserIdentityPinTables,
} from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { createExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
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
           encapsulation_public_key, encapsulation_key_fingerprint, first_seen_at,
           provenance
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          alias.provenance,
        ],
      ),
    ).rejects.toThrow(/UNIQUE/);
    expect(await loadTrustedUserIdentityPin({ execSql, ...alias })).toBeNull();
  } finally {
    close();
  }
});

test("a repeat verification of a pinned identity reads once without the write lock", async () => {
  const { close, execSql } = await createTestExecSql("identity-pin-fast-path");
  const statements: string[] = [];
  const traced = createExecSql({
    async exec({ sql, bind, rowMode }) {
      statements.push(sql.toLowerCase());
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  const verify = async (pin: ReturnType<typeof createPin>) => {
    statements.length = 0;
    const result = await compareOrInsertTrustedUserIdentityPin({
      execSql: traced,
      pin,
    }).catch((error: unknown) => error);
    return { result, statements: [...statements] };
  };
  try {
    const linked = createPin({ provenance: "link" });
    await verify(linked);
    // First contact took the transaction (after the fast path's empty read).
    // A repeat, and a lower-ranked observation, is one read in a deferred
    // transaction (was 5 statements under the write lock).
    for (const pin of [
      linked,
      createPin(),
      createPin({ firstSeenAt: "2026-07-16T12:00:00.000Z" }),
    ]) {
      const repeat = await verify(pin);
      expect(repeat.result).toEqual(linked);
      expect(repeat.statements).toEqual([
        "begin",
        expect.stringMatching(/^select/),
        "commit",
      ]);
    }
    // A raise, a mismatch, an alias and first contact still take the
    // transaction, with the results and errors it always returned.
    const raised = await verify(createPin({ provenance: "self" }));
    expect(raised.result).toEqual(createPin({ provenance: "self" }));
    expect(raised.statements).toContain("begin immediate");
    const mismatch = await verify(
      createPin({ encapsulationPublicKey: "encapsulation-public-key-b" }),
    );
    expect(mismatch.result).toMatchObject({
      code: "trusted_user_identity_pin_mismatch",
      differingFields: ["encapsulationPublicKey"],
    });
    expect(mismatch.statements).toContain("begin immediate");
    const alias = await verify(createPin({ userId: "server-alias" }));
    expect(alias.result).toMatchObject({
      code: "trusted_user_identity_pin_mismatch",
      differingFields: ["userId"],
    });
    expect(alias.statements).toContain("begin immediate");
    const other = createPin({
      userId: "user-2",
      signingKeyFingerprint: "signing-fingerprint-2",
    });
    expect((await verify(other)).statements).toContain("begin immediate");
    await execSql(
      `UPDATE trusted_user_identity_pins SET signing_public_key = ''
       WHERE user_id = ?`,
      [other.userId],
    );
    const corrupt = await verify(other);
    expect(corrupt.result).toMatchObject({
      code: "trusted_user_identity_pin_corrupt",
    });
    expect(corrupt.statements).toContain("begin immediate");
  } finally {
    close();
  }
});

test.each([false, true])(
  "the repeat read never answers from an uncommitted pin: second adapter=%s",
  async (secondAdapter) => {
    const { close, execSql } = await createTestExecSql(
      "identity-pin-fast-rollback",
    );
    try {
      const pin = createPin({ provenance: "link" });
      await ensureSqlTables(execSql, trustedUserIdentityPinTables);
      const runtime = getClientSQLitePersistenceRuntime(execSql);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let inserted = () => {};
      const insertedPin = new Promise<void>((resolve) => {
        inserted = resolve;
      });
      const rolledBack = runtime
        .transaction(async (tx) => {
          await tx.insert(trustedUserIdentityPins).values(pin).run();
          inserted();
          await held;
          throw new Error("roll back the uncommitted pin");
        })
        .catch(() => "rolled back");
      await insertedPin;
      // A second adapter over the same connection has its own mutation queue.
      const reader = secondAdapter
        ? createExecSql({
            async exec({ sql, bind, rowMode }) {
              return {
                rows: await execSql(
                  sql,
                  bind,
                  rowMode ? { rowMode } : undefined,
                ),
              };
            },
          })
        : execSql;
      let answered = false;
      const repeat = compareOrInsertTrustedUserIdentityPin({
        execSql: reader,
        pin: createPin(),
      }).finally(() => {
        answered = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(answered).toBe(false);
      release();
      expect(await rolledBack).toBe("rolled back");
      // The rolled-back link pin is gone; the waiting call is first contact.
      expect(await repeat).toEqual(createPin());
    } finally {
      close();
    }
  },
);
