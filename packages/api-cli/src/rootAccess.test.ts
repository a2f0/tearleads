import { expect, test } from "bun:test";
import {
  type ApiDatabase,
  createDefaultManagedApiDatabase,
} from "@tearleads/api-shared/postgres";
import { rootAuditEvents, users } from "@tearleads/api-shared/schema";
import {
  computeUserIdentityBundleFingerprint,
  encodeIdentityLinkToken,
  IDENTITY_LINK_PATH,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { asc, eq } from "drizzle-orm";
import {
  formatRootAccessOutcome,
  parseRootAccessArgs,
  resolveIdentityLinkFingerprint,
  setIdentityRootAccess,
} from "./rootAccess";

const FINGERPRINT = "ab".repeat(32);
const TRUST_DOMAIN = "https://api.example.test/v1";
const SIGNING_PUBLIC_KEY = new Uint8Array([1, 2, 3]);
const ENCAPSULATION_PUBLIC_KEY = new Uint8Array([4, 5, 6]);

async function insertIdentity(db: ApiDatabase): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(users)
    .values({
      defaultOrganizationId: crypto.randomUUID(),
      encapsulationKeyFingerprint: "cd".repeat(32),
      encapsulationPublicKey: bytesToBase64(ENCAPSULATION_PUBLIC_KEY),
      fingerprint: FINGERPRINT,
      signingPublicKey: bytesToBase64(SIGNING_PUBLIC_KEY),
    })
    .returning({ id: users.id });
  if (!inserted) {
    throw new Error("expected inserted user");
  }
  return inserted;
}

/** `db`, except that every insert inside a transaction throws. */
function withFailingTransactionInserts(db: ApiDatabase): ApiDatabase {
  const failInserts = <T extends object>(tx: T): T =>
    new Proxy(tx, {
      get(target, property) {
        if (property === "insert") {
          return () => {
            throw new Error("audit store unavailable");
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return (run: (tx: object) => Promise<unknown>) =>
          target.transaction((tx) => run(failInserts(tx)));
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The identity link the app would copy for `userId` holding the test keys. */
async function identityLinkFor(
  userId: string,
  keys: {
    readonly encapsulationPublicKey: Uint8Array;
    readonly signingPublicKey: Uint8Array;
  } = {
    encapsulationPublicKey: ENCAPSULATION_PUBLIC_KEY,
    signingPublicKey: SIGNING_PUBLIC_KEY,
  },
): Promise<string> {
  const fingerprint = await computeUserIdentityBundleFingerprint({
    ...keys,
    identityTrustDomain: TRUST_DOMAIN,
    userId,
  });
  const token = encodeIdentityLinkToken({
    fingerprint,
    identityTrustDomain: TRUST_DOMAIN,
    userId,
  });
  return `https://app.example.test${IDENTITY_LINK_PATH}${token}`;
}

function parsedLink(link: string) {
  const target = parseRootAccessArgs([link]);
  if (target.kind !== "identity-link") {
    throw new Error("expected an identity link target");
  }
  return target.link;
}

test("root access args take exactly one hex fingerprint or identity link", async () => {
  expect(parseRootAccessArgs([FINGERPRINT])).toEqual({
    fingerprint: FINGERPRINT,
    kind: "fingerprint",
  });
  const userId = crypto.randomUUID();
  expect(parseRootAccessArgs([await identityLinkFor(userId)])).toMatchObject({
    kind: "identity-link",
    link: { identityTrustDomain: TRUST_DOMAIN, userId },
  });
  expect(() => parseRootAccessArgs([])).toThrow(
    "A signing key fingerprint or identity link is required",
  );
  expect(() => parseRootAccessArgs([FINGERPRINT, "--force"])).toThrow(
    "Unknown argument: --force",
  );
  for (const malformed of [
    "not-a-fingerprint",
    FINGERPRINT.toUpperCase(),
    `${await identityLinkFor(userId)}?extra=1`,
  ]) {
    expect(() => parseRootAccessArgs([malformed])).toThrow(
      "Expected the 64-character lowercase hex signing key fingerprint or a complete identity link",
    );
  }
});

test("an identity link resolves to its identity's fingerprint only when it commits to the registered keys", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const inserted = await insertIdentity(managed.db);

    await expect(
      resolveIdentityLinkFingerprint(
        managed.db,
        parsedLink(await identityLinkFor(inserted.id)),
      ),
    ).resolves.toBe(FINGERPRINT);

    const otherKeys = await identityLinkFor(inserted.id, {
      encapsulationPublicKey: ENCAPSULATION_PUBLIC_KEY,
      signingPublicKey: new Uint8Array([9, 9, 9]),
    });
    await expect(
      resolveIdentityLinkFingerprint(managed.db, parsedLink(otherKeys)),
    ).rejects.toThrow(
      `The identity link does not match the keys registered for user ID ${inserted.id}`,
    );

    const unknownUserId = crypto.randomUUID();
    await expect(
      resolveIdentityLinkFingerprint(
        managed.db,
        parsedLink(await identityLinkFor(unknownUserId)),
      ),
    ).rejects.toThrow(
      `No identity is registered with user ID ${unknownUserId}`,
    );
  } finally {
    await managed.close();
  }
}, 15_000);

test("root access flips is_root for the fingerprint's identity and is idempotent", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const inserted = await insertIdentity(managed.db);

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

    // Only the two changes are recorded, each with no actor; the repeated
    // grant changed nothing and left no row.
    const audit = await managed.db
      .select({
        action: rootAuditEvents.action,
        actorUserId: rootAuditEvents.actorUserId,
        targetUserId: rootAuditEvents.targetUserId,
      })
      .from(rootAuditEvents)
      .orderBy(asc(rootAuditEvents.occurredAt), asc(rootAuditEvents.action));
    expect(audit).toEqual([
      {
        action: "root.access.grant",
        actorUserId: null,
        targetUserId: inserted.id,
      },
      {
        action: "root.access.revoke",
        actorUserId: null,
        targetUserId: inserted.id,
      },
    ]);

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

test("concurrent grants record a single root access change", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    await insertIdentity(managed.db);

    const results = await Promise.all([
      setIdentityRootAccess(managed.db, {
        fingerprint: FINGERPRINT,
        isRoot: true,
      }),
      setIdentityRootAccess(managed.db, {
        fingerprint: FINGERPRINT,
        isRoot: true,
      }),
    ]);

    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(await managed.db.select().from(rootAuditEvents)).toHaveLength(1);
  } finally {
    await managed.close();
  }
}, 15_000);

test("a root access change whose audit row cannot be written is rolled back", async () => {
  const managed = createDefaultManagedApiDatabase({ API_DATABASE: "memory" });
  try {
    await managed.migrate();
    const inserted = await insertIdentity(managed.db);
    const readIsRoot = async () => {
      const [row] = await managed.db
        .select({ isRoot: users.isRoot })
        .from(users)
        .where(eq(users.id, inserted.id));
      return row?.isRoot;
    };
    const failing = withFailingTransactionInserts(managed.db);

    await expect(
      setIdentityRootAccess(failing, {
        fingerprint: FINGERPRINT,
        isRoot: true,
      }),
    ).rejects.toThrow("audit store unavailable");
    await expect(readIsRoot()).resolves.toBe(false);

    await setIdentityRootAccess(managed.db, {
      fingerprint: FINGERPRINT,
      isRoot: true,
    });
    await expect(
      setIdentityRootAccess(failing, {
        fingerprint: FINGERPRINT,
        isRoot: false,
      }),
    ).rejects.toThrow("audit store unavailable");
    await expect(readIsRoot()).resolves.toBe(true);
    expect(await managed.db.select().from(rootAuditEvents)).toHaveLength(1);
  } finally {
    await managed.close();
  }
}, 15_000);
