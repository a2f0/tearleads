import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPin } from "../../../test/helpers/trustedUserIdentityPin";
import { createExecSql } from "../sqlite/sqlSchema";
import {
  compareOrInsertTrustedUserIdentityPin,
  loadTrustedUserIdentityPin,
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
