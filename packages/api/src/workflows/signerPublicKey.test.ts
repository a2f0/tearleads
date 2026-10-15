import { expect, test } from "bun:test";
import {
  type DatabaseSession,
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import { loadSignerPublicKey } from "./signerPublicKey";

class SignerAccessError extends Error {
  constructor(
    message: string,
    readonly status: 403,
  ) {
    super(message);
  }
}

function signerAccessError(message: string, status: 403): SignerAccessError {
  return new SignerAccessError(message, status);
}

async function insertSigner(
  fingerprint: string,
  signingPublicKey: Uint8Array,
  executor: DatabaseSession = db,
  userId: string = crypto.randomUUID(),
): Promise<string> {
  await executor.insert(users).values({
    defaultOrganizationId: crypto.randomUUID(),
    encapsulationKeyFingerprint: `encapsulation-${userId}`,
    encapsulationPublicKey: "AA==",
    fingerprint,
    id: userId,
    signingPublicKey: bytesToBase64(signingPublicKey),
  });
  return userId;
}

test("loads and decodes the matching signer public key", async () => {
  const fingerprint = `signer-${crypto.randomUUID()}`;
  const signingPublicKey = new Uint8Array([0, 1, 2, 255]);
  const userId = await insertSigner(fingerprint, signingPublicKey);

  try {
    await expect(
      loadSignerPublicKey(db, {
        error: signerAccessError,
        fingerprint,
        userId,
      }),
    ).resolves.toEqual(signingPublicKey);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
});

test("rejects a signer fingerprint mismatch with the caller error", async () => {
  const fingerprint = `signer-${crypto.randomUUID()}`;
  const userId = await insertSigner(fingerprint, new Uint8Array([1]));

  try {
    await expect(
      loadSignerPublicKey(db, {
        error: signerAccessError,
        fingerprint: `other-${crypto.randomUUID()}`,
        userId,
      }),
    ).rejects.toEqual(new SignerAccessError("Forbidden", 403));
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
});

test("rejects a missing signer with the caller error", async () => {
  await expect(
    loadSignerPublicKey(db, {
      error: signerAccessError,
      fingerprint: `signer-${crypto.randomUUID()}`,
      userId: crypto.randomUUID(),
    }),
  ).rejects.toEqual(new SignerAccessError("Forbidden", 403));
});

test("a transaction reads each signer row once", async () => {
  const fingerprint = `signer-${crypto.randomUUID()}`;
  const signingPublicKey = new Uint8Array([3, 4]);
  const userId = await insertSigner(fingerprint, signingPublicKey);
  const input = { error: signerAccessError, fingerprint, userId };

  try {
    await db.transaction(async (tx) => {
      const counter = { statements: 0 };
      await withDatabaseStatementCounter(counter, async () => {
        await expect(loadSignerPublicKey(tx, input)).resolves.toEqual(
          signingPublicKey,
        );
        await expect(loadSignerPublicKey(tx, input)).resolves.toEqual(
          signingPublicKey,
        );
        // A mismatched fingerprint is still refused from the cached row.
        await expect(
          loadSignerPublicKey(tx, { ...input, fingerprint: "other" }),
        ).rejects.toEqual(new SignerAccessError("Forbidden", 403));
      });
      expect(counter.statements).toBe(1);
    });

    // The root executor shares nothing across calls without a request cache.
    const rootCounter = { statements: 0 };
    await withDatabaseStatementCounter(rootCounter, async () => {
      await loadSignerPublicKey(db, input);
      await loadSignerPublicKey(db, input);
    });
    expect(rootCounter.statements).toBe(2);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
});

test("a transaction does not remember a signer that was missing", async () => {
  const fingerprint = `signer-${crypto.randomUUID()}`;
  const signingPublicKey = new Uint8Array([5]);
  const userId = crypto.randomUUID();
  const input = { error: signerAccessError, fingerprint, userId };

  try {
    await db.transaction(async (tx) => {
      await expect(loadSignerPublicKey(tx, input)).rejects.toEqual(
        new SignerAccessError("Forbidden", 403),
      );
      await insertSigner(fingerprint, signingPublicKey, tx, userId);
      await expect(loadSignerPublicKey(tx, input)).resolves.toEqual(
        signingPublicKey,
      );
    });
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
});
