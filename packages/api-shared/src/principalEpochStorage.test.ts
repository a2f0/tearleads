import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  accessManifestPrincipalHeadProjection,
  principalEpochKeys,
  principalHistoryProgress,
  principalMemberEnvelopes,
  principalStates,
} from "./schema";
import { isSqliteSchemaDialect } from "./schema/dialect";

// Exercise the generated PostgreSQL baseline and Drizzle's number mapping,
// rather than trusting SQLite (whose INTEGER already accepts 64-bit values).
test.skipIf(isSqliteSchemaDialect())(
  "principal key epoch columns round-trip positive safe integers beyond int32",
  async () => {
    const client = new PGlite();
    try {
      const database = drizzle(client);
      await migrate(database, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      const principalId = crypto.randomUUID();
      for (const keyEpoch of [16_385, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
        const [state] = await database
          .insert(principalStates)
          .values({
            principalType: "group",
            principalId,
            version: keyEpoch,
            prevStateHash: "numeric-storage-fixture",
            keyEpoch,
            encapsulationPublicKey: "fixture",
            keyFingerprint: "fixture",
            membershipMode: "projection",
            membershipRoot: "fixture",
            memberEnvelopesRoot: "fixture",
            projectionRoot: "fixture",
            grantRoot: "fixture",
            payloadCiphertextHash: "fixture",
            memberCount: 1,
            grantCount: 0,
            stateHash: String(keyEpoch),
            signedAt: new Date(),
            signerUserId: crypto.randomUUID(),
            signerUserKeyFingerprint: "fixture",
            signature: "fixture",
          })
          .returning();
        expect(state?.keyEpoch).toBe(keyEpoch);
        const [head] = await database
          .insert(accessManifestPrincipalHeadProjection)
          .values({
            manifestHash: String(keyEpoch),
            objectKind: "container",
            objectId: crypto.randomUUID(),
            principalType: "group",
            principalId,
            version: keyEpoch,
            keyEpoch,
            stateHash: String(keyEpoch),
            keyFingerprint: "fixture",
          })
          .returning();
        expect(head?.keyEpoch).toBe(keyEpoch);
        const [key] = await database
          .insert(principalEpochKeys)
          .values({
            principalType: "group",
            principalId,
            epoch: keyEpoch,
            introducedByStateHash: String(keyEpoch),
            encapsulationPublicKey: "fixture",
            keyFingerprint: "fixture",
          })
          .returning();
        expect(key?.epoch).toBe(keyEpoch);
        const [envelope] = await database
          .insert(principalMemberEnvelopes)
          .values({
            principalType: "group",
            principalId,
            epoch: keyEpoch,
            stateHash: String(keyEpoch),
            userId: crypto.randomUUID(),
            memberKeyFingerprint: "fixture",
            kemCipherText: "fixture",
            wrappedKey: "fixture",
          })
          .returning();
        expect(envelope?.epoch).toBe(keyEpoch);
        const [progress] = await database
          .insert(principalHistoryProgress)
          .values({
            principalType: "group",
            principalId,
            keyEpoch,
            version: keyEpoch,
            stateHash: String(keyEpoch),
            verificationKind: "policy",
            protectionId: "fixture",
            inputHash: "fixture",
            keyFingerprint: "fixture",
            progress: "fixture",
          })
          .returning();
        expect(progress?.keyEpoch).toBe(keyEpoch);
      }
      for (const keyEpoch of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(
          database
            .update(principalStates)
            .set({ keyEpoch })
            .where(eq(principalStates.keyEpoch, 16_385))
            .execute(),
        ).rejects.toMatchObject({
          cause: {
            code: "23514",
            constraint: "principal_states_key_epoch_range",
          },
        });
        await expect(
          database
            .update(accessManifestPrincipalHeadProjection)
            .set({ keyEpoch })
            .where(eq(accessManifestPrincipalHeadProjection.keyEpoch, 16_385))
            .execute(),
        ).rejects.toMatchObject({
          cause: {
            code: "23514",
            constraint:
              "access_manifest_principal_head_projection_key_epoch_range",
          },
        });
        await expect(
          database
            .update(principalEpochKeys)
            .set({ epoch: keyEpoch })
            .execute(),
        ).rejects.toMatchObject({
          cause: {
            code: "23514",
            constraint: "principal_epoch_keys_epoch_range",
          },
        });
        await expect(
          database
            .update(principalMemberEnvelopes)
            .set({ epoch: keyEpoch })
            .execute(),
        ).rejects.toMatchObject({
          cause: {
            code: "23514",
            constraint: "principal_member_envelopes_epoch_range",
          },
        });
        await expect(
          database.update(principalHistoryProgress).set({ keyEpoch }).execute(),
        ).rejects.toMatchObject({
          cause: {
            code: "23514",
            constraint: "principal_history_progress_key_epoch_range",
          },
        });
      }
    } finally {
      await client.close();
    }
  },
);
