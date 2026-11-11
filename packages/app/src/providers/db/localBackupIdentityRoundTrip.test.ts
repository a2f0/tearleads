import { expect, test } from "bun:test";
import {
  createMemoryBlobStore,
  recoverPrincipalPolicyHistory,
} from "@tearleads/client-sdk";
import {
  clientSQLiteSchema,
  defineSqlTableSchema,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createBackupPolicyProducer } from "../../../test/helpers/backupPolicyProducer";
import { unexpectedSecurityIncidents } from "../../../test/helpers/unexpectedSecurityIncidents";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";
import { readBackupDatabase } from "./localBackupDatabase";
import { decodeBackupFile, encodeBackupFile } from "./localBackupFormat";

test("SDK-produced private history survives encrypted round-trip with live identity pins and absent lazy tables", async () => {
  const producer = await createBackupPolicyProducer();
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  const blobStore = createMemoryBlobStore();
  try {
    const options = {
      historyReader: producer.historyReader,
      execSql: source.execSql,
      organizationId: crypto.randomUUID(),
      expectedHead: producer.head,
      resolveTrustedUserIdentity: producer.resolveTrustedUserIdentity,
      protection: {
        localKey: new Uint8Array(32).fill(7),
        context: "backup-round-trip",
      },
      stillCurrent: () => true,
    };
    const recovered = await recoverPrincipalPolicyHistory(options);
    expect(recovered.current.currentProjection).toEqual(
      producer.bundle.currentProjection,
    );
    const before = await readBackupDatabase({ execSql: source.execSql });
    expect(
      before.tables.find((table) => table.name === "principal_history_prefixes")
        ?.rows,
    ).toHaveLength(1);
    const pinSchema = clientSQLiteSchema.trustedUserIdentityPins;
    await target.execSql(defineSqlTableSchema(pinSchema).createSql);
    const pins = getSQLitePersistenceRuntime(target.execSql).db;
    await pins
      .insert(pinSchema)
      .values({
        identityTrustDomain: "https://api.example.test",
        userId: producer.signerUserId,
        formatVersion: 1,
        signingSuite: "ML-DSA-87",
        signingPublicKey: bytesToBase64(
          producer.signingKeyPair.signingPublicKey,
        ),
        signingKeyFingerprint: producer.signingFingerprint,
        encapsulationSuite: "ML-KEM-1024",
        encapsulationPublicKey: bytesToBase64(
          producer.creatorEncapsulationKeyPair.publicKey,
        ),
        encapsulationKeyFingerprint: await toFingerprint(
          producer.creatorEncapsulationKeyPair.publicKey,
        ),
        firstSeenAt: "2026-11-11T00:00:00.000Z",
        provenance: "self",
      })
      .run();
    const heldPins = await pins.select().from(pinSchema);
    const payload = await createBackupPayload({
      blobStore,
      execSql: source.execSql,
      databaseId: null,
      signingFingerprint: null,
    });
    const text = await encodeBackupFile({ payload, password: "round-trip" });
    await restoreBackupPayload({
      blobStore,
      execSql: target.execSql,
      payload: await decodeBackupFile({ text, password: "round-trip" }),
      securityIncidents: unexpectedSecurityIncidents,
    });
    const after = await readBackupDatabase({ execSql: target.execSql });
    for (const table of before.tables)
      expect(
        after.tables.find((candidate) => candidate.name === table.name),
      ).toEqual(table);
    expect(after.tableNames.has("organization_provisioning_attempts")).toBe(
      false,
    );
    expect(await pins.select().from(pinSchema)).toEqual(heldPins);
    const restored = await recoverPrincipalPolicyHistory({
      ...options,
      execSql: target.execSql,
      offline: true,
    });
    expect(restored.current.currentProjection).toEqual(
      recovered.current.currentProjection,
    );
  } finally {
    source.close();
    target.close();
  }
});
