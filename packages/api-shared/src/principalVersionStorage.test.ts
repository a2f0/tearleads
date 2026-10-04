import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  accessManifestPrincipalHeadProjection,
  principalStates,
} from "./schema";
import { isSqliteSchemaDialect } from "./schema/dialect";

// Exercise the generated PostgreSQL baseline and Drizzle's number mapping,
// rather than trusting SQLite (whose INTEGER already accepts 64-bit values).
test.skipIf(isSqliteSchemaDialect())(
  "principal version columns round-trip positive safe integers beyond int32",
  async () => {
    const client = new PGlite();
    try {
      const database = drizzle(client);
      await migrate(database, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      const principalId = crypto.randomUUID();
      for (const version of [16_385, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
        const [state] = await database
          .insert(principalStates)
          .values({
            principalType: "group",
            principalId,
            version,
            prevStateHash: "numeric-storage-fixture",
            keyEpoch: 1,
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
            stateHash: String(version),
            signedAt: new Date(),
            signerUserId: crypto.randomUUID(),
            signerUserKeyFingerprint: "fixture",
            signature: "fixture",
          })
          .returning();
        expect(state?.version).toBe(version);
        const [head] = await database
          .insert(accessManifestPrincipalHeadProjection)
          .values({
            manifestHash: String(version),
            objectKind: "container",
            objectId: crypto.randomUUID(),
            principalType: "group",
            principalId,
            version,
            keyEpoch: 1,
            stateHash: String(version),
            keyFingerprint: "fixture",
          })
          .returning();
        expect(head?.version).toBe(version);
      }
      for (const version of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(
          database
            .update(principalStates)
            .set({ version })
            .where(eq(principalStates.version, 16_385))
            .execute(),
        ).rejects.toMatchObject({
          cause: {
            code: "23514",
            constraint: "principal_states_version_range",
          },
        });
        await expect(
          database
            .update(accessManifestPrincipalHeadProjection)
            .set({ version })
            .where(eq(accessManifestPrincipalHeadProjection.version, 16_385))
            .execute(),
        ).rejects.toMatchObject({
          cause: {
            code: "23514",
            constraint:
              "access_manifest_principal_head_projection_version_range",
          },
        });
      }
    } finally {
      await client.close();
    }
  },
);
