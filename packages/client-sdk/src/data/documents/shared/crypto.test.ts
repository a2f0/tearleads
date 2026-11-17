import { expect, test } from "bun:test";
import { computeDocumentContentRecordPlaintextHash } from "@tearleads/crypto";
import {
  createDocument,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { assertDocumentUpdatePlaintextHash } from "./plaintextHash";

async function importPlaintextHashTestKey(seed: number): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(32).fill(seed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

test("plaintext hashes distinguish forged content with the same version-vector shape", async () => {
  const honest = await createDocument("plaintext-hash-proof");
  honest.getText("text").update("honest history");
  const honestSnapshot = exportFullHistorySnapshot(honest);

  const forged = await createDocument("plaintext-hash-proof");
  forged.getText("text").update("forged history");
  const forgedSnapshot = exportFullHistorySnapshot(forged);

  expect(getUpdateVersionVectors(forgedSnapshot)).toEqual(
    getUpdateVersionVectors(honestSnapshot),
  );
  const plaintextHashKey = await importPlaintextHashTestKey(1);
  const honestHash = await computeDocumentContentRecordPlaintextHash(
    honestSnapshot,
    plaintextHashKey,
  );
  expect(
    await computeDocumentContentRecordPlaintextHash(
      forgedSnapshot,
      plaintextHashKey,
    ),
  ).not.toBe(honestHash);
  await expect(
    assertDocumentUpdatePlaintextHash(
      forgedSnapshot,
      honestHash,
      plaintextHashKey,
    ),
  ).rejects.toThrow("Document update plaintext hash mismatch");
  expect(
    await computeDocumentContentRecordPlaintextHash(
      honestSnapshot,
      await importPlaintextHashTestKey(2),
    ),
  ).not.toBe(honestHash);
});
