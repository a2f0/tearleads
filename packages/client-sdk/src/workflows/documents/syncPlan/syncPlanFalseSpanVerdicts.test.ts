import { expect, test } from "bun:test";
import { computeDocumentContentRecordCiphertextHash } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../test/helpers/data/documentFixtures";
import { replaceEncryptedPlaintext } from "../../../../test/helpers/data/replaceEncryptedPlaintext";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { judgeDocumentSyncUpdateDecryption } from "../../../data/documents/shared/crypto";
import { validateDocumentSyncUpdateImports } from "../../../data/documents/shared/sync/documentSyncImportVerdicts";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { withoutVoidedUpdates } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

const ids = {
  after: "550e8400-e29b-41d4-a716-446655440603",
  before: "550e8400-e29b-41d4-a716-446655440601",
  liar: "550e8400-e29b-41d4-a716-446655440602",
};

interface Edit {
  readonly data: Uint8Array;
  readonly end: string;
  readonly start: string;
}

async function edits(name: string, count: number): Promise<Edit[]> {
  const document = await createDocument(name);
  const result: Edit[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = encodeVersionVector(document);
    document.getText("text").insert(0, `${name}-${index} `);
    document.commit();
    const data = exportUpdatesSince(document, before);
    const vectors = getUpdateVersionVectors(data);
    result.push({
      data,
      end: vectors.partialEndVersionVector,
      start: vectors.partialStartVersionVector,
    });
  }
  document.free();
  return result;
}

function pending(id: string, data: Uint8Array, start: string, end: string) {
  return createPendingUpdateRecord({
    id,
    partialEndVersionVector: end,
    partialStartVersionVector: start,
    updateData: bytesToBase64(data),
  });
}

/** A page of honest A, the liar's U, and honest B, as an honest server serves it. */
async function judgePage(liar: ReturnType<typeof pending>) {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const [first, second] = await edits("verdict-honest", 1).then(
    async (honest) => [honest[0], (await edits("verdict-other", 1))[0]],
  );
  if (!first || !second) throw new Error("expected honest edits");
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      pending(ids.before, first.data, first.start, first.end),
      liar,
      pending(ids.after, second.data, second.start, second.end),
    ],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  return {
    contentKey,
    materialized,
    response,
    // Decryption checks the plaintext hash; the import judge checks each
    // payload against its signed span, as a sync pass runs them.
    judge: async (updates: typeof response.updates) => {
      const decrypted = await judgeDocumentSyncUpdateDecryption({
        contentKeysByEpoch: new Map([
          [materialized.plan.contentKeyEpoch, contentKey],
        ]),
        documentId: materialized.plan.documentId,
        organizationId: materialized.plan.organizationId,
        updates,
      });
      const reader = await createDocument("verdict-reader");
      const verdicts = await validateDocumentSyncUpdateImports({
        currentDocument: reader,
        decryptedUpdates: decrypted.accepted,
        responseUpdates: updates,
      });
      reader.free();
      return {
        accepted: withoutVoidedUpdates(decrypted.accepted, verdicts),
        voided: [...decrypted.voided, ...verdicts.voided],
      };
    },
  };
}

async function expectOnlyLiarVoided(liar: ReturnType<typeof pending>) {
  const { judge, response } = await judgePage(liar);
  const { accepted, voided } = await judge(response.updates);
  expect(accepted.map((update) => update.id)).toEqual([ids.before, ids.after]);
  expect(voided.map((entry) => entry.updateId)).toEqual([ids.liar]);
  return voided[0];
}

test("an update that declares operations it does not carry is void, and the page continues", async () => {
  const [one, two] = await edits("verdict-overclaim", 2);
  if (!one || !two) throw new Error("expected two edits");
  // Carries only the first edit but declares both.
  const voided = await expectOnlyLiarVoided(
    pending(ids.liar, one.data, one.start, two.end),
  );
  expect(voided?.stage).toBe("loro_metadata");
  expect(voided?.error.writerUserId).not.toBeNull();
});

test("an update that hides operations past its declared span is void, never partly applied", async () => {
  const [one, two] = await edits("verdict-underclaim", 2);
  if (!one || !two) throw new Error("expected two edits");
  const both = await createDocument("verdict-underclaim");
  both.getText("text").insert(0, "verdict-underclaim-0 ");
  both.commit();
  both.getText("text").insert(0, "verdict-underclaim-1 ");
  both.commit();
  const bothData = exportUpdatesSince(both, undefined);
  both.free();
  // Carries both edits but declares only the first.
  await expectOnlyLiarVoided(pending(ids.liar, bothData, one.start, one.end));
});

test("an update that declares another peer's span is void", async () => {
  const [carried] = await edits("verdict-carried-peer", 1);
  const [declared] = await edits("verdict-declared-peer", 1);
  if (!carried || !declared) throw new Error("expected edits");
  await expectOnlyLiarVoided(
    pending(ids.liar, carried.data, declared.start, declared.end),
  );
});

test("an update that declares an empty span is void", async () => {
  const [carried] = await edits("verdict-empty-span", 1);
  if (!carried) throw new Error("expected an edit");
  await expectOnlyLiarVoided(
    pending(ids.liar, carried.data, carried.start, carried.start),
  );
});

test("an ordinary update that carries a snapshot is void", async () => {
  const document = await createDocument("verdict-snapshot-mode");
  document.getText("text").insert(0, "snapshot");
  document.commit();
  const snapshot = exportFullHistorySnapshot(document);
  const vectors = getUpdateVersionVectors(snapshot);
  document.free();
  const voided = await expectOnlyLiarVoided(
    pending(
      ids.liar,
      snapshot,
      vectors.partialStartVersionVector,
      vectors.partialEndVersionVector,
    ),
  );
  expect(voided?.stage).toBe("loro_metadata");
});

test("a payload whose signed plaintext hash does not match is void", async () => {
  const [carried] = await edits("verdict-plaintext", 1);
  if (!carried) throw new Error("expected an edit");
  const { contentKey, judge, materialized, response } = await judgePage(
    pending(ids.liar, carried.data, carried.start, carried.end),
  );
  const updates = await Promise.all(
    response.updates.map((update) =>
      update.id === ids.liar
        ? replaceEncryptedPlaintext({
            contentKey,
            documentId: materialized.plan.documentId,
            organizationId: materialized.plan.organizationId,
            update,
          })
        : update,
    ),
  );
  const { accepted, voided } = await judge(updates);
  expect(accepted.map((update) => update.id)).toEqual([ids.before, ids.after]);
  expect(voided.map((entry) => entry.stage)).toEqual(["plaintext_integrity"]);
});

test("AES-GCM failure still fails the pass: the reader cannot prove its key is the writer's", async () => {
  const [carried] = await edits("verdict-aead", 1);
  if (!carried) throw new Error("expected an edit");
  const { judge, response } = await judgePage(
    pending(ids.liar, carried.data, carried.start, carried.end),
  );
  const tampered = await Promise.all(
    response.updates.map(async (update) => {
      if (update.id !== ids.liar) return update;
      const envelope = JSON.parse(update.encryptedData) as { iv: string };
      // A different IV authenticates under no key, as a wrong epoch key would
      // not; the signed header still names this exact ciphertext.
      envelope.iv = bytesToBase64(new Uint8Array(12));
      const encryptedData = JSON.stringify(envelope);
      return {
        ...update,
        encryptedData,
        writeHeader: {
          ...update.writeHeader,
          ciphertextHash:
            await computeDocumentContentRecordCiphertextHash(encryptedData),
        },
      };
    }),
  );
  const failure = await judge(tampered).then(
    () => null,
    (error: unknown) => error,
  );
  expect(isDocumentSyncUpdateIsolationError(failure)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(failure)) return;
  expect(failure.stage).toBe("decrypt");
});
