import { expect, test } from "bun:test";
import {
  DOCUMENTS_APP_KIND,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import {
  clientSQLiteSchema,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { and, eq } from "drizzle-orm";
import {
  createRecoveryContactsRuntime,
  setPersistedContactDocumentIdentity,
} from "../../../test/helpers/contactStoreRecovery";
import { loadCurrentSelfContactIdentity } from "./currentSelfContactIdentity";
import { getSelfContactLocalId } from "./selfContact";

const FINGERPRINT = "canonical-ui-identity";

test("Me identity includes a persisted alias outside the Contacts container", async () => {
  const runtime = await createRecoveryContactsRuntime({
    containerId: "another-container",
    runtimeKey: "canonical-ui-identity-reader",
    signingFingerprint: FINGERPRINT,
    userId: "current-user",
  });
  try {
    const localId = getSelfContactLocalId(FINGERPRINT);
    const documentId = await deriveStableDocumentId(localId);
    const alias = "independently-recovered-alias";
    const document = runtime.openDocumentStore({
      localId: alias,
      initialDocumentKind: "contact",
      initialStructuredFields: { isSelf: "0", userId: "unrelated-field" },
    });
    expect(await document.ensureInitialized()).toBe(true);
    await setPersistedContactDocumentIdentity(runtime, alias, documentId);

    const identity = await loadCurrentSelfContactIdentity(
      runtime.documents.infra.execSql,
      FINGERPRINT,
    );
    expect(identity.documentId).toBe(documentId);
    expect(identity.localIds.has(alias)).toBe(true);
    expect(identity.localIds.has(localId)).toBe(true);
  } finally {
    runtime.close();
  }
});

test.each([
  ["reset alias", "alias", null, "canonical", true],
  ["rebound alias", "alias", "other", "canonical", false],
  ["occupied canonical local ID", "local", "other", null, false],
  ["reset occupied local ID", "local", null, "other", false],
  ["unbound remote-shaped local ID", "remote", null, null, false],
  ["local-only canonical document", "local", null, null, true],
  [
    "current identity before recovery identity",
    "alias",
    "canonical",
    "other",
    true,
  ],
] as const)(
  "Me identity respects persisted metadata: %s",
  async (name, localKind, remoteKind, recoveryKind, expected) => {
    const runtime = await createRecoveryContactsRuntime({
      runtimeKey: `canonical-ui-${name}`,
      signingFingerprint: FINGERPRINT,
      userId: "current-user",
    });
    try {
      const canonicalLocalId = getSelfContactLocalId(FINGERPRINT);
      const canonicalDocumentId =
        await deriveStableDocumentId(canonicalLocalId);
      const otherDocumentId = await deriveStableDocumentId("distinct-history");
      const localId =
        localKind === "local"
          ? canonicalLocalId
          : localKind === "remote"
            ? canonicalDocumentId
            : "recovery-alias";
      const document = runtime.openDocumentStore({
        localId,
        initialDocumentKind: "contact",
        initialStructuredFields: { isSelf: "1", userId: "current-user" },
      });
      expect(await document.ensureInitialized()).toBe(true);
      const execSql = runtime.documents.infra.execSql;
      const { db } = getSQLitePersistenceRuntime(execSql);
      const { documents } = clientSQLiteSchema;
      const where = and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.localId, localId),
      );
      const resolveId = (kind: typeof remoteKind | typeof recoveryKind) =>
        kind === null
          ? null
          : kind === "canonical"
            ? canonicalDocumentId
            : otherDocumentId;
      // Model already-admitted metadata, including rebound records. Ordinary
      // saveDocument deliberately clears recovery identity when documentId is set.
      const expectedMetadata = {
        documentId: resolveId(remoteKind),
        recoveryDocumentId: resolveId(recoveryKind),
      };
      await db.update(documents).set(expectedMetadata).where(where);
      const before = await db.select().from(documents).where(where);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject(expectedMetadata);

      const identity = await loadCurrentSelfContactIdentity(
        execSql,
        FINGERPRINT,
      );
      expect(identity.localIds.has(localId)).toBe(expected);
      expect(await db.select().from(documents).where(where)).toEqual(before);
    } finally {
      runtime.close();
    }
  },
);
