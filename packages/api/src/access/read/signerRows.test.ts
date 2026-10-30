import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type { SignedPrincipalState } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import { loadPrincipalStateSigner } from "../shared/internal/principalStateSigner";
import { loadSignerRow } from "./signerRows";

test("the principal state signer read joins the transaction's signer memo", async () => {
  const userId = crypto.randomUUID();
  const fingerprint = `signer-${userId}`;
  const signingPublicKey = new Uint8Array([9, 10]);
  await db.insert(users).values({
    defaultOrganizationId: crypto.randomUUID(),
    encapsulationKeyFingerprint: `encapsulation-${userId}`,
    encapsulationPublicKey: "AA==",
    fingerprint,
    id: userId,
    signingPublicKey: bytesToBase64(signingPublicKey),
  });
  const state = {
    principalId: crypto.randomUUID(),
    signerUserId: userId,
    signerUserKeyFingerprint: fingerprint,
  } as SignedPrincipalState;

  try {
    await db.transaction(async (tx) => {
      const counter = { statements: 0 };
      await withDatabaseStatementCounter(counter, async () => {
        expect((await loadSignerRow(tx, userId))?.fingerprint).toBe(
          fingerprint,
        );
        await expect(loadPrincipalStateSigner(state, tx)).resolves.toEqual({
          signingPublicKey,
          userId,
        });
        // The fingerprint check still runs on the memoized row.
        await expect(
          loadPrincipalStateSigner(
            { ...state, signerUserKeyFingerprint: "other" },
            tx,
          ),
        ).rejects.toThrow("Principal state signer fingerprint mismatch");
      });
      expect(counter.statements).toBe(1);
    });
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
});
