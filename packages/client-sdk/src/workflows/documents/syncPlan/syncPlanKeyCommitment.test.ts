import { expect, spyOn, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../test/helpers/data/documentFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { judgeDocumentSyncUpdateDecryption } from "../../../data/documents/shared/crypto";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

type ServedUpdate = Awaited<
  ReturnType<typeof createSyncResponse>
>["updates"][number];

/** One honest update as an honest server serves it, and a reader's judge. */
async function servedUpdate() {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const [update] = (await createSyncResponse(materialized.plan)).updates;
  if (!update) throw new Error("expected a served update");
  const judge = (served: ServedUpdate, readerKey: Uint8Array = contentKey) =>
    judgeDocumentSyncUpdateDecryption({
      contentKeysByEpoch: new Map([
        [materialized.plan.contentKeyEpoch, readerKey],
      ]),
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: [served],
    });
  return { judge, update };
}

/** The pass's failure: none of these may resolve into a verdict. */
async function failedStage(judged: Promise<unknown>) {
  const failure = await judged.then(
    () => null,
    (error: unknown) => error,
  );
  if (!isDocumentSyncUpdateIsolationError(failure)) {
    throw new Error(`expected an isolated failure, got ${String(failure)}`);
  }
  return failure.stage;
}

interface ServedEnvelope {
  ciphertext: string;
  contentKeyCommitment: string;
}

function withEnvelope(
  update: ServedUpdate,
  edit: (envelope: ServedEnvelope) => void,
): ServedUpdate {
  const envelope = JSON.parse(update.encryptedData) as ServedEnvelope;
  edit(envelope);
  // The server cannot sign: the header keeps the writer's ciphertext hash.
  return { ...update, encryptedData: JSON.stringify(envelope) };
}

test("an honest update commits to the key its readers hold", async () => {
  const { judge, update } = await servedUpdate();
  const { accepted, voided } = await judge(update);
  expect(accepted.map((entry) => entry.id)).toEqual([update.id]);
  expect(voided).toEqual([]);
});

test("a commitment the server altered fails the signed hash, never a void", async () => {
  const { judge, update } = await servedUpdate();
  const altered = withEnvelope(update, (envelope) => {
    envelope.contentKeyCommitment = "d".repeat(64);
  });
  expect(await failedStage(judge(altered))).toBe("encrypted_record");
});

test("a ciphertext the server altered fails the signed hash, never a void", async () => {
  const { judge, update } = await servedUpdate();
  const altered = withEnvelope(update, (envelope) => {
    const ciphertext = base64ToBytes(envelope.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    envelope.ciphertext = bytesToBase64(ciphertext);
  });
  expect(await failedStage(judge(altered))).toBe("encrypted_record");
});

test("a reader holding another key than the committed one voids nothing", async () => {
  const { judge, update } = await servedUpdate();
  const otherKey = crypto.getRandomValues(new Uint8Array(32));
  expect(await failedStage(judge(update, otherKey))).toBe("content_key");
});

test("a decryption failure of the local runtime voids nothing", async () => {
  const { judge, update } = await servedUpdate();
  const decrypt = spyOn(crypto.subtle, "decrypt").mockImplementationOnce(() =>
    Promise.reject(new RangeError("Out of memory")),
  );
  try {
    expect(await failedStage(judge(update))).toBe("decrypt_runtime");
  } finally {
    decrypt.mockRestore();
  }
  const deriveKey = spyOn(crypto.subtle, "deriveKey").mockImplementationOnce(
    () => Promise.reject(new DOMException("derive", "OperationError")),
  );
  try {
    expect(await failedStage(judge(update))).toBe("decrypt_runtime");
  } finally {
    deriveKey.mockRestore();
  }
});

test("one AES-GCM refusal that does not repeat voids nothing", async () => {
  const { judge, update } = await servedUpdate();
  const decrypt = spyOn(crypto.subtle, "decrypt").mockImplementationOnce(() =>
    Promise.reject(new DOMException("backend", "OperationError")),
  );
  try {
    const { accepted, voided } = await judge(update);
    expect(accepted.map((entry) => entry.id)).toEqual([update.id]);
    expect(voided).toEqual([]);
  } finally {
    decrypt.mockRestore();
  }
});

test("an engine that refuses even its own canary voids nothing", async () => {
  const { judge, update } = await servedUpdate();
  const decrypt = spyOn(crypto.subtle, "decrypt").mockImplementation(() =>
    Promise.reject(new DOMException("backend", "OperationError")),
  );
  try {
    expect(await failedStage(judge(update))).toBe("decrypt_runtime");
  } finally {
    decrypt.mockRestore();
  }
});
