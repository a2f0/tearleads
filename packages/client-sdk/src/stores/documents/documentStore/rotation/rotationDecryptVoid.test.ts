import { expect, test } from "bun:test";
import {
  computeDocumentContentRecordCiphertextHash,
  signWriteHeader,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  getTextValue,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncUpdateResponse } from "@tearleads/validators/response";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../../test/helpers/data/documentFixtures";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { buildMaterializedDocumentSyncPlan } from "../../../../workflows/documents/syncPlan/syncPlanMaterial";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";

type Fixture = Awaited<ReturnType<typeof createRemoteHistoryFixture>>;

/**
 * An update its writer signed over a ciphertext the committed key does not
 * open: the envelope still commits to the epoch's key, and the signed header
 * names this exact ciphertext.
 */
async function undecryptableUpdate(
  fixture: Fixture,
  id: string,
): Promise<DocumentSyncUpdateResponse> {
  const document = await createDocument("rotation-decrypt-void");
  document.getText("text").update("rotation-decrypt-void");
  document.commit();
  const data = exportAllUpdates(document);
  document.free();
  const { plan } = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        id,
        updateData: bytesToBase64(data),
        ...getUpdateVersionVectors(data),
      }),
    ],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const [update] = (
    await createSyncResponse(plan, { acceptedOutgoingUpdateIds: [] })
  ).updates;
  if (!update) throw new Error("expected a signed update");
  const envelope = JSON.parse(update.encryptedData) as { iv: string };
  envelope.iv = bytesToBase64(new Uint8Array(12));
  const encryptedData = JSON.stringify(envelope);
  const { signature: _signature, ...unsigned } = update.writeHeader;
  const writeHeader = await signWriteHeader(
    {
      ...unsigned,
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
    },
    fixture.author.signerPrivateKey,
  );
  return { ...update, encryptedData, writeHeader };
}

// An AES-GCM failure under the committed key is decided by the update alone,
// so a rotation that leaves it out of the rebuild records it, as a sync pass
// does, rather than leaving the device to judge it again.
test("rotation records an update its committed key cannot decrypt", async () => {
  const { close, execSql } = await createTestExecSql("rotation-decrypt-void");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-decrypt-void-local";
    const voidedId = "550e8400-e29b-41d4-a716-446655440461";
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const undecryptable = await undecryptableUpdate(fixture, voidedId);
    const state = createDocumentStoreState(
      localId,
      createRotationRecoveryRuntime({
        execSql,
        fixture,
        responseForRequest: (_request, response) => ({
          ...response,
          updates: [...response.updates, undecryptable],
        }),
      }),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);

    await assertDocumentStoreCanRotateContentKey(state);
    expect(state.doc && getTextValue(state.doc)).toBe("survives key rotation");
    expect(
      await execSql(
        "SELECT update_id, stage FROM document_void_updates WHERE local_id = ?",
        [localId],
      ),
    ).toEqual([{ stage: "decrypt", update_id: voidedId }]);
  } finally {
    close();
  }
});
