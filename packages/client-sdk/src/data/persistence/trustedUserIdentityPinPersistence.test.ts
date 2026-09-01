import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createExecSql } from "../sqlite/sqlSchema";
import {
  compareOrInsertTrustedUserIdentityPin,
  loadTrustedUserIdentityPin,
  type TrustedUserIdentityPin,
  TrustedUserIdentityPinCorruptError,
  TrustedUserIdentityPinInputError,
  TrustedUserIdentityPinMismatchError,
} from "./trustedUserIdentityPinPersistence";

function createPin(
  overrides: Partial<TrustedUserIdentityPin> = {},
): TrustedUserIdentityPin {
  return {
    identityTrustDomain: "https://api.example.test/v1",
    userId: "user-1",
    formatVersion: 1,
    signingSuite: "ML-DSA-87",
    signingPublicKey: "signing-public-key-a",
    signingKeyFingerprint: "signing-fingerprint-a",
    encapsulationSuite: "ML-KEM-1024",
    encapsulationPublicKey: "encapsulation-public-key-a",
    encapsulationKeyFingerprint: "encapsulation-fingerprint-a",
    firstSeenAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

test("trusted identity pins are inserted once and loaded by trust domain", async () => {
  const { close, execSql } = await createTestExecSql("trusted-identity-insert");
  const pin = createPin();

  try {
    await expect(
      loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: pin.identityTrustDomain,
        userId: pin.userId,
      }),
    ).resolves.toBeNull();

    await expect(
      compareOrInsertTrustedUserIdentityPin({ execSql, pin }),
    ).resolves.toEqual(pin);
    await expect(
      loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: pin.identityTrustDomain,
        userId: pin.userId,
      }),
    ).resolves.toEqual(pin);
  } finally {
    close();
  }
});

test("matching observations preserve the original first-seen timestamp", async () => {
  const { close, execSql } = await createTestExecSql("trusted-identity-repeat");
  const first = createPin();
  const repeated = createPin({ firstSeenAt: "2026-07-16T12:00:00.000Z" });

  try {
    await compareOrInsertTrustedUserIdentityPin({ execSql, pin: first });

    await expect(
      compareOrInsertTrustedUserIdentityPin({ execSql, pin: repeated }),
    ).resolves.toEqual(first);
  } finally {
    close();
  }
});

test("every identity field is immutable after first contact", async () => {
  const { close, execSql } = await createTestExecSql(
    "trusted-identity-immutable",
  );
  const changes = [
    ["signingPublicKey", "signing-public-key-b"],
    ["signingKeyFingerprint", "signing-fingerprint-b"],
    ["encapsulationPublicKey", "encapsulation-public-key-b"],
    ["encapsulationKeyFingerprint", "encapsulation-fingerprint-b"],
  ] as const;

  try {
    for (const [index, [field, value]] of changes.entries()) {
      const first = createPin({ userId: `user-${index}` });
      const candidate = { ...first, [field]: value };
      await compareOrInsertTrustedUserIdentityPin({ execSql, pin: first });

      let thrown: unknown;
      try {
        await compareOrInsertTrustedUserIdentityPin({
          execSql,
          pin: candidate,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TrustedUserIdentityPinMismatchError);
      expect(thrown).toMatchObject({
        code: "trusted_user_identity_pin_mismatch",
        differingFields: [field],
        identityTrustDomain: first.identityTrustDomain,
        userId: first.userId,
      });
      expect(JSON.stringify(thrown)).not.toContain(first.signingPublicKey);
      expect(JSON.stringify(thrown)).not.toContain(
        first.encapsulationPublicKey,
      );
      await expect(
        loadTrustedUserIdentityPin({
          execSql,
          identityTrustDomain: first.identityTrustDomain,
          userId: first.userId,
        }),
      ).resolves.toEqual(first);
    }
  } finally {
    close();
  }
});

test("pins are independently scoped by trust domain and user", async () => {
  const { close, execSql } = await createTestExecSql("trusted-identity-scope");
  const pins = [
    createPin(),
    createPin({
      identityTrustDomain: "https://other.example.test/v1",
      signingPublicKey: "other-domain-signing-key",
    }),
    createPin({
      userId: "user-2",
      signingPublicKey: "other-user-signing-key",
    }),
  ];

  try {
    for (const pin of pins) {
      await compareOrInsertTrustedUserIdentityPin({ execSql, pin });
    }
    for (const pin of pins) {
      await expect(
        loadTrustedUserIdentityPin({
          execSql,
          identityTrustDomain: pin.identityTrustDomain,
          userId: pin.userId,
        }),
      ).resolves.toEqual(pin);
    }
  } finally {
    close();
  }
});

test("concurrent divergent first contacts leave exactly one durable pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "trusted-identity-concurrent",
  );
  const candidates = [
    createPin({ signingPublicKey: "candidate-a" }),
    createPin({ signingPublicKey: "candidate-b" }),
  ] as const;

  try {
    const settled = await Promise.allSettled(
      candidates.map((pin) =>
        compareOrInsertTrustedUserIdentityPin({ execSql, pin }),
      ),
    );
    const fulfilled = settled.filter((result) => result.status === "fulfilled");
    const rejected = settled.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: {
        code: "trusted_user_identity_pin_mismatch",
      },
    });
    const winner = fulfilled[0];
    if (!winner || winner.status !== "fulfilled") {
      throw new Error("Expected one winning first-contact candidate");
    }
    await expect(
      loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: winner.value.identityTrustDomain,
        userId: winner.value.userId,
      }),
    ).resolves.toEqual(winner.value);
  } finally {
    close();
  }
});

test("distinct adapters racing first schema creation yield one typed concurrent loser", async () => {
  const { close, execSql } = await createTestExecSql(
    "trusted-identity-distinct-adapters",
  );
  const createAdapter = () =>
    createExecSql({
      async exec({ sql, bind, rowMode }) {
        const rows =
          rowMode === "array"
            ? await execSql(sql, bind, { rowMode: "array" })
            : await execSql(sql, bind);
        return { rows };
      },
    });
  const candidates = [
    createPin({ signingPublicKey: "adapter-candidate-a" }),
    createPin({ signingPublicKey: "adapter-candidate-b" }),
  ] as const;

  try {
    const settled = await Promise.allSettled(
      candidates.map((pin) =>
        compareOrInsertTrustedUserIdentityPin({
          execSql: createAdapter(),
          pin,
        }),
      ),
    );

    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = settled.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: "trusted_user_identity_pin_mismatch" },
    });
  } finally {
    close();
  }
});

test("malformed persisted rows fail closed", async () => {
  const { close, execSql } = await createTestExecSql(
    "trusted-identity-corrupt",
  );
  const pin = createPin();

  try {
    await compareOrInsertTrustedUserIdentityPin({ execSql, pin });
    await execSql(
      `UPDATE trusted_user_identity_pins
       SET signing_public_key = ''
       WHERE identity_trust_domain = ? AND user_id = ?`,
      [pin.identityTrustDomain, pin.userId],
    );

    await expect(
      loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: pin.identityTrustDomain,
        userId: pin.userId,
      }),
    ).rejects.toBeInstanceOf(TrustedUserIdentityPinCorruptError);
    await expect(
      compareOrInsertTrustedUserIdentityPin({ execSql, pin }),
    ).rejects.toMatchObject({ code: "trusted_user_identity_pin_corrupt" });
  } finally {
    close();
  }
});

test("invalid candidates fail before creating a durable row", async () => {
  const { close, execSql } = await createTestExecSql(
    "trusted-identity-invalid-input",
  );
  const pin = createPin({ signingPublicKey: "" });

  try {
    await expect(
      compareOrInsertTrustedUserIdentityPin({ execSql, pin }),
    ).rejects.toBeInstanceOf(TrustedUserIdentityPinInputError);
    await expect(
      loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: pin.identityTrustDomain,
        userId: pin.userId,
      }),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("candidate pins require the current format version and suites", async () => {
  const { close, execSql } = await createTestExecSql(
    "trusted-identity-current-format-input",
  );
  const invalidFields = [
    ["formatVersion", 2, "formatVersion must be 1"],
    ["signingSuite", "ML-DSA-65", "signingSuite must be ML-DSA-87"],
    [
      "encapsulationSuite",
      "ML-KEM-768",
      "encapsulationSuite must be ML-KEM-1024",
    ],
  ] as const;

  try {
    for (const [index, [field, value, reason]] of invalidFields.entries()) {
      const pin = createPin({ userId: `invalid-format-user-${index}` });
      const candidate = { ...pin, [field]: value };

      await expect(
        compareOrInsertTrustedUserIdentityPin({ execSql, pin: candidate }),
      ).rejects.toMatchObject({
        code: "trusted_user_identity_pin_invalid_input",
        reason,
      });
      await expect(
        loadTrustedUserIdentityPin({
          execSql,
          identityTrustDomain: pin.identityTrustDomain,
          userId: pin.userId,
        }),
      ).resolves.toBeNull();
    }
  } finally {
    close();
  }
});

test("stored pins require the current format version and suites", async () => {
  const { close, execSql } = await createTestExecSql(
    "trusted-identity-current-format-storage",
  );
  const invalidFields = [
    ["format_version", 2, "formatVersion must be 1"],
    ["signing_suite", "ML-DSA-65", "signingSuite must be ML-DSA-87"],
    [
      "encapsulation_suite",
      "ML-KEM-768",
      "encapsulationSuite must be ML-KEM-1024",
    ],
  ] as const;

  try {
    for (const [index, [column, value, reason]] of invalidFields.entries()) {
      const pin = createPin({ userId: `stored-format-user-${index}` });
      await compareOrInsertTrustedUserIdentityPin({ execSql, pin });
      await execSql(
        `UPDATE trusted_user_identity_pins
         SET ${column} = ?
         WHERE identity_trust_domain = ? AND user_id = ?`,
        [value, pin.identityTrustDomain, pin.userId],
      );

      await expect(
        loadTrustedUserIdentityPin({
          execSql,
          identityTrustDomain: pin.identityTrustDomain,
          userId: pin.userId,
        }),
      ).rejects.toMatchObject({
        code: "trusted_user_identity_pin_corrupt",
        reason,
      });
    }
  } finally {
    close();
  }
});

test("compare-or-insert uses an immediate transaction", async () => {
  const { close, execSql } = await createTestExecSql(
    "trusted-identity-immediate",
  );
  const statements: string[] = [];
  const tracingExecSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      statements.push(sql);
      const rows =
        rowMode === "array"
          ? await execSql(sql, bind, { rowMode: "array" })
          : await execSql(sql, bind);
      return { rows };
    },
  });

  try {
    await compareOrInsertTrustedUserIdentityPin({
      execSql: tracingExecSql,
      pin: createPin(),
    });
    expect(statements.map((sql) => sql.toLowerCase())).toContain(
      "begin immediate",
    );
  } finally {
    close();
  }
});
