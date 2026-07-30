import { expect, test } from "bun:test";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@tearleads/loro";
import { isAuthenticatedReplayableBaseline } from "./documentReplayableBaseline";

async function fixture() {
  const document = await createDocument("replayable-baseline-test");
  document.getText("text").update("checkpoint state");
  document.commit();
  const documentId = crypto.randomUUID();
  const updateId = crypto.randomUUID();
  const partialStartVersionVector = emptyVersionVector();
  const partialEndVersionVector = encodeVersionVector(document);
  const plaintextHash = "replayable-baseline-plaintext-hash";
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    checkpointKind: "rotate_baseline",
    checkpointPayloadKind: "full_history_snapshot",
    documentId,
    partialEndVersionVector,
    partialStartVersionVector,
    plaintextHash,
    sourceVersionVector: partialEndVersionVector,
    updateId,
  });
  return {
    checkpointKind: "rotate_baseline",
    documentId,
    metadataHash,
    partialEndVersionVector,
    partialStartVersionVector,
    plaintextHash,
    sourceVersionVector: partialEndVersionVector,
    updateId,
  };
}

test("accepts a consistent checkpoint with an authenticated replayable-snapshot attestation", async () => {
  expect(await isAuthenticatedReplayableBaseline(await fixture())).toBe(true);
});

test("rejects a legacy checkpoint whose metadata hash did not bind checkpoint fields", async () => {
  const baseline = await fixture();
  const legacyMetadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: baseline.documentId,
    partialEndVersionVector: baseline.partialEndVersionVector,
    partialStartVersionVector: baseline.partialStartVersionVector,
    plaintextHash: baseline.plaintextHash,
    updateId: baseline.updateId,
  });
  expect(
    await isAuthenticatedReplayableBaseline({
      ...baseline,
      metadataHash: legacyMetadataHash,
    }),
  ).toBe(false);
});

test("rejects exaggerated checkpoint coverage", async () => {
  const baseline = await fixture();
  const ahead = await createDocument("replayable-baseline-ahead");
  ahead.getText("text").update("unrelated future state");
  ahead.commit();
  expect(
    await isAuthenticatedReplayableBaseline({
      ...baseline,
      sourceVersionVector: encodeVersionVector(ahead),
    }),
  ).toBe(false);
});

test("rejects an authenticated dependency-bearing rotation baseline", async () => {
  const baseline = await fixture();
  const partialStartVersionVector = baseline.partialEndVersionVector;
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    checkpointKind: "rotate_baseline",
    checkpointPayloadKind: "full_history_snapshot",
    documentId: baseline.documentId,
    partialEndVersionVector: baseline.partialEndVersionVector,
    partialStartVersionVector,
    plaintextHash: baseline.plaintextHash,
    sourceVersionVector: baseline.sourceVersionVector,
    updateId: baseline.updateId,
  });

  expect(
    await isAuthenticatedReplayableBaseline({
      ...baseline,
      metadataHash,
      partialStartVersionVector,
    }),
  ).toBe(false);
});
